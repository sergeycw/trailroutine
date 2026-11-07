import type { EngineStatus } from '@/engine/engine';
import type { Activity } from '@/routing/brouter';
import type { Router } from '@/routing/router';
import type { LatLng } from '@/tracks/model';

// A fake router for the browser tests of the editor: each request waits until the test answers it (resolve/reject),
// or gets a straight line with a bend in the middle at once (auto). It does not use the network. The test sets the
// engine status.

export interface FakeCall {
    from: LatLng;
    to: LatLng;
    activity: Activity;
    signal?: AbortSignal;
    resolve(points: LatLng[]): void;
    reject(error: Error): void;
}

export interface FakeRouter extends Router {
    calls: FakeCall[];
    // the requests that still wait for an answer
    live(): FakeCall[];
    setStatus(status: EngineStatus): void;
    warmUps: number;
}

// a "route" between two points: a bend in the middle, so that the simplification does not remove it
export function bend(from: LatLng, to: LatLng): LatLng[] {
    return [{ lat: (from.lat + to.lat) / 2 + Math.abs(to.lng - from.lng) / 4, lng: (from.lng + to.lng) / 2 }];
}

export function fakeRouter({ auto = false, status = 'ready' as EngineStatus } = {}): FakeRouter {
    const listeners = new Set<() => void>();
    const settled = new Set<FakeCall>();
    let current = status;
    const router: FakeRouter = {
        calls: [],
        warmUps: 0,
        live: () => router.calls.filter((call) => !call.signal?.aborted && !settled.has(call)),
        setStatus(next) {
            current = next;
            for (const listener of listeners) {
                listener();
            }
        },
        route: (from, to, activity, signal) =>
            new Promise((resolve, reject) => {
                const call: FakeCall = {
                    from,
                    to,
                    activity,
                    signal,
                    resolve: (points) => {
                        settled.add(call);
                        resolve(points);
                    },
                    reject: (error) => {
                        settled.add(call);
                        reject(error);
                    },
                };
                router.calls.push(call);
                signal?.addEventListener('abort', () => reject(signal.reason));
                if (auto) {
                    call.resolve(bend(from, to));
                }
            }),
        warmUp: () => {
            router.warmUps += 1;
        },
        isReachable: async () => current !== 'failed',
        status: () => current,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return router;
}
