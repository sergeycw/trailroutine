import { config } from '@/config';
import { type EngineBackend, mainThreadBackend, workerBackend } from '@/engine/backends';
import { enginePaths } from '@/engine/cheerpj-router';
import { createEngine } from '@/engine/engine';

// The engine test bench (engine-bench.html): cold start, route time and the block of the main
// thread. Address parameters: backend=worker|main-thread (worker by default), q=<BRouter request>,
// runs=<number of routes>. The result is JSON in <pre> and window.__bench.
// A MessageChannel ping measures the block: in a background tab rAF does not tick (AGENTS.md, CheerpJ).

// The test area of the tests and the bench: Tbilisi, from ~41.687, 44.776 to the Mtatsminda TV tower, tile E40_N40.
const DEFAULT_QUERY =
    'lonlats=44.776000,41.687000|44.751500,41.694700&profile=hiking-mountain&alternativeidx=0&format=geojson';
// a task longer than 50 ms is a long task by the definition of the Long Tasks API
const LONG_TASK_MS = 50;

interface Blocking {
    maxGapMs: number;
    blockedMs: number;
    pings: number;
}

function startPinger() {
    const channel = new MessageChannel();
    let last = performance.now();
    let stats: Blocking = { maxGapMs: 0, blockedMs: 0, pings: 0 };
    let running = true;
    channel.port1.onmessage = () => {
        const now = performance.now();
        const gap = now - last;
        last = now;
        stats.pings++;
        stats.maxGapMs = Math.max(stats.maxGapMs, gap);
        if (gap > LONG_TASK_MS) {
            stats.blockedMs += gap;
        }
        if (running) {
            channel.port2.postMessage(null);
        }
    };
    channel.port2.postMessage(null);
    return {
        // a snapshot for the phase, then a reset
        take(): Blocking {
            const result = { ...stats, maxGapMs: Math.round(stats.maxGapMs), blockedMs: Math.round(stats.blockedMs) };
            stats = { maxGapMs: 0, blockedMs: 0, pings: 0 };
            last = performance.now();
            return result;
        },
        stop() {
            running = false;
        },
    };
}

async function run() {
    const params = new URLSearchParams(location.search);
    const backendName = params.get('backend') ?? 'worker';
    const query = params.get('q') ?? DEFAULT_QUERY;
    const runs = Number(params.get('runs') ?? 2);
    const paths = enginePaths(config.routingEngineRuntimeUrl, config.routingTilesPath);
    const backend: () => EngineBackend =
        backendName === 'main-thread' ? () => mainThreadBackend(paths) : () => workerBackend(paths);
    const engine = createEngine([backend]);
    const pinger = startPinger();
    const result: Record<string, unknown> = { backend: backendName, routingTilesPath: config.routingTilesPath };

    let t = performance.now();
    await engine.start();
    result.coldStartMs = Math.round(performance.now() - t);
    result.startBlocking = pinger.take();

    const routes = [];
    for (let i = 0; i < runs; i++) {
        t = performance.now();
        const geojson = await engine.route(query);
        const ms = Math.round(performance.now() - t);
        const feature = JSON.parse(geojson).features[0];
        routes.push({
            ms,
            points: feature.geometry.coordinates.length,
            length: feature.properties['track-length'],
            blocking: pinger.take(),
        });
    }
    result.routes = routes;
    pinger.stop();
    return result;
}

const output = document.getElementById('result') as HTMLElement;
run().then(
    (result) => {
        Object.assign(window, { __bench: result });
        output.textContent = JSON.stringify(result, null, 2);
    },
    (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        Object.assign(window, { __bench: { error: message } });
        output.textContent = `error: ${message}`;
    },
);
