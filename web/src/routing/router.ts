import type { RoutingEngine } from '@/config';
import { type Engine, EngineStartError, type EngineStatus } from '@/engine/engine';
import type { LatLng } from '@/tracks/model';
import { type Activity, parseRoute, RoutingError, routeQuery } from './brouter';

// The app router: the in-browser engine (the clone) or the server BRouter (locally, docker-compose.yml) behind one
// interface; the editor gets the same result: leg points or RoutingError (spec browser-routing-engine,
// «Выбор движка флагом конфигурации»). Cancellation: AbortSignal, a rejection with signal.reason, the editor drops it
// without a message.

export interface Router {
    // kind 'preview': a route for the drag preview, not for the line (MapEditor); the routers handle it as any route,
    // the fake router of the tests keeps it apart
    route(from: LatLng, to: LatLng, activity: Activity, signal?: AbortSignal, kind?: 'preview'): Promise<LatLng[]>;
    // warm-up on activity selection: the engine runtime loads before the first click (spec browser-routing-engine)
    warmUp(): void;
    // is the router alive: a new check when the routing menu opens (spec routing, «Недоступный роутер»)
    isReachable(): Promise<boolean>;
    // the engine state for the routing button; the server has nothing to load, so it is always ready
    status(): EngineStatus;
    subscribe(listener: () => void): () => void;
}

export interface RouterOptions {
    engine: RoutingEngine;
    routingServer: string;
    fetch: typeof fetch;
    // the engine is created lazily (getEngine): while routing is off, the CheerpJ runtime does not load
    getEngine: () => Engine;
}

// timeouts of the old client (lib/brouter): route 30 s, alive check 3 s
const ROUTE_TIMEOUT = 30_000;
const PROBE_TIMEOUT = 3_000;

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
    return signal?.aborted === true && error === signal.reason;
}

export function createRouter({ engine, routingServer, fetch, getEngine }: RouterOptions): Router {
    if (engine === 'browser') {
        return {
            async route(from, to, activity, signal) {
                let geojson: string;
                try {
                    geojson = await getEngine().route(routeQuery(from, to, activity), signal);
                } catch (error) {
                    if (isAbort(error, signal)) {
                        throw error;
                    }
                    if (error instanceof EngineStartError) {
                        throw new RoutingError(error.message, true);
                    }
                    throw new RoutingError(error instanceof Error ? error.message : String(error));
                }
                return parseRoute(geojson, from, to);
            },
            warmUp() {
                getEngine()
                    .start()
                    .catch(() => {});
            },
            // a not yet started engine counts as alive: it starts on the first route (isEngineFailed of the old client)
            isReachable: async () => getEngine().status() !== 'failed',
            status: () => getEngine().status(),
            subscribe: (listener) => getEngine().subscribe(listener),
        };
    }

    const brouterUrl = new URL('/brouter', routingServer).href;
    return {
        async route(from, to, activity, signal) {
            const timeout = AbortSignal.timeout(ROUTE_TIMEOUT);
            let response: Response;
            try {
                response = await fetch(`${brouterUrl}?${routeQuery(from, to, activity)}`, {
                    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
                });
            } catch (error) {
                if (isAbort(error, signal)) {
                    throw error;
                }
                throw new RoutingError('BRouter is not reachable', true);
            }
            const text = await response.text();
            if (!response.ok) {
                // BRouter writes the reason as the response text (datafile … not found, no track found …)
                throw new RoutingError(text.trim() || `HTTP ${response.status}`);
            }
            return parseRoute(text, from, to);
        },
        warmUp() {},
        // GET /brouter with no parameters answers 404: any HTTP response means a live server, a network error does not
        async isReachable() {
            try {
                await fetch(brouterUrl, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
                return true;
            } catch {
                return false;
            }
        },
        status: () => 'ready',
        subscribe: () => () => {},
    };
}

// A short status for the button hint, and what the user can do (routerDownStatus/routerDownHint of the old client). The
// command is for the server mode: docker-compose.yml in the repository root starts BRouter on 17777.
export function routerDownStatus(engine: RoutingEngine): string {
    return engine === 'browser' ? 'BRouter engine failed to load' : 'BRouter is not running';
}

export function routerDownHint(engine: RoutingEngine): string {
    return engine === 'browser'
        ? 'BRouter engine failed to load, reload the page to retry'
        : 'BRouter is not running, start it with docker compose up -d';
}
