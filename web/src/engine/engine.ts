import { config } from '@/config';
import { reportEngineBackendError } from '@/errors/tracking';
import { type EngineBackend, mainThreadBackend, workerBackend } from './backends';
import { enginePaths } from './cheerpj-router';

// The BRouter engine in the browser (spec browser-routing-engine). A singleton outside React: CheerpJ gives one library
// thread per page, and Strict Mode in dev calls effects two times, so a component does not create the engine.
// App passes getEngine to the router (routing/router.ts): its warmUp() calls start() when an activity is selected or
// is already selected at the page load, and a route goes to route() in the queue. Until the first getEngine() call,
// the runtime does not load.

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';

// The engine did not start in the worker or on the main thread (or hung there): for the UI it is «router unreachable».
export class EngineStartError extends Error {
    override name = 'EngineStartError';
}

// The calculation exceeded routeTimeout: for the UI a leg error, the router is alive (the worker engine restarts)
export class EngineTimeoutError extends Error {
    override name = 'EngineTimeoutError';
}

// The calculation timeout (design add-engine-timeout): two times the server 30 s, because the engine reads tiles over
// the network and on a phone it is slower than the server. The count starts with the calculation, the queue and the
// cold start are not included
export const ENGINE_ROUTE_TIMEOUT = 60_000;

export interface EngineOptions {
    routeTimeout?: number;
    // a start failure of one backend, before the move to the next one: the error tracker (spec clone-monitoring,
    // «Движок не запустился»). The final EngineStartError and a route failure do not come here
    onBackendError?: (backend: EngineBackend['name'], error: unknown) => void;
}

export interface Engine {
    start(): Promise<void>;
    route(query: string, signal?: AbortSignal): Promise<string>;
    status(): EngineStatus;
    // where the engine runs now; null while it is not started
    backend(): EngineBackend['name'] | null;
    subscribe(listener: () => void): () => void;
}

// The backends are tried in order: the first one that starts becomes the engine. A failed one is discarded (the worker
// stops), and the next start begins from the first one again.
export function createEngine(
    backends: Array<() => EngineBackend>,
    { routeTimeout = ENGINE_ROUTE_TIMEOUT, onBackendError }: EngineOptions = {},
): Engine {
    let current: EngineBackend | null = null;
    // the engine on the main thread hung: it cannot be unloaded or started again (a second cheerpjInit throws), so the
    // router is unreachable until a page reload
    let hung = false;
    let starting: Promise<EngineBackend> | null = null;
    let status: EngineStatus = 'idle';
    // the queue tail: requests go to the engine strictly one at a time, the tail never rejects
    let tail: Promise<void> = Promise.resolve();
    const listeners = new Set<() => void>();

    function setStatus(next: EngineStatus) {
        status = next;
        for (const listener of listeners) {
            listener();
        }
    }

    async function startBackends(): Promise<EngineBackend> {
        setStatus('loading');
        let lastError: unknown = null;
        for (const create of backends) {
            const backend = create();
            try {
                await backend.start();
                current = backend;
                setStatus('ready');
                return backend;
            } catch (error) {
                backend.dispose();
                lastError = error;
                onBackendError?.(backend.name, error);
            }
        }
        setStatus('failed');
        const reason = lastError instanceof Error ? lastError.message : String(lastError);
        throw new EngineStartError(`BRouter engine failed to start: ${reason}`);
    }

    function ensureStarted(): Promise<EngineBackend> {
        if (hung) {
            return Promise.reject(new EngineStartError('BRouter engine stopped responding'));
        }
        if (!starting) {
            starting = startBackends().catch((error: unknown) => {
                // a start failure does not stick: the next route request tries again
                starting = null;
                throw error;
            });
        }
        return starting;
    }

    // A hung calculation cannot be stopped from inside CheerpJ. The worker stops, and the next request goes through
    // ensureStarted from the start: a new worker, a clean restart; the engine warms up immediately, so that the next
    // click does not wait for a cold start. The main thread cannot be unloaded: the engine is marked as hung until the
    // calculation ends (a fired timer shows that CheerpJ released the thread: probably a slow route, not a dead one)
    function afterTimeout(backend: EngineBackend, route: Promise<string>) {
        if (backend.name === 'main-thread') {
            hung = true;
            setStatus('failed');
            route
                .catch(() => {})
                .finally(() => {
                    hung = false;
                    setStatus('ready');
                });
            return;
        }
        // dispose rejects the hung route after the timeout, so the timeout error already won the race (diff review)
        backend.dispose();
        current = null;
        starting = null;
        setStatus('idle');
        ensureStarted().catch(() => {});
    }

    async function routeWithTimeout(backend: EngineBackend, query: string): Promise<string> {
        const route = backend.route(query);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(
                    backend.name === 'main-thread'
                        ? new EngineStartError('BRouter engine stopped responding')
                        : new EngineTimeoutError(
                              `BRouter engine did not answer in ${Math.round(routeTimeout / 1000)} s`,
                          ),
                );
                afterTimeout(backend, route);
            }, routeTimeout);
        });
        try {
            return await Promise.race([route, timeout]);
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        async start() {
            await ensureStarted();
        },
        route(query, signal) {
            return new Promise<string>((resolve, reject) => {
                if (signal?.aborted) {
                    reject(signal.reason);
                    return;
                }
                // Cancellation removes the request from the queue. A started CheerpJ calculation cannot be stopped: the
                // caller gets the rejection immediately, and the next request waits until the engine is free or the
                // timeout fires.
                const onAbort = () => reject(signal?.reason);
                signal?.addEventListener('abort', onAbort, { once: true });
                const run = async () => {
                    if (signal?.aborted) {
                        return;
                    }
                    try {
                        const backend = await ensureStarted();
                        resolve(await routeWithTimeout(backend, query));
                    } catch (error) {
                        reject(error);
                    } finally {
                        signal?.removeEventListener('abort', onAbort);
                    }
                };
                tail = tail.then(run);
            });
        },
        status: () => status,
        backend: () => current?.name ?? null,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

// The CheerpJ runtime comes only from the Leaning Technologies CDN (Community license, spec browser-routing-engine).
function defaultBackends(): Array<() => EngineBackend> {
    const paths = enginePaths(config.routingEngineRuntimeUrl, config.routingTilesPath);
    return [() => workerBackend(paths), () => mainThreadBackend(paths)];
}

let engine: Engine | null = null;

export function getEngine(): Engine {
    // tracker reports only from the app engine: /engine-bench.html and the tests build their own engine without it
    engine ??= createEngine(defaultBackends(), { onBackendError: reportEngineBackendError });
    return engine;
}
