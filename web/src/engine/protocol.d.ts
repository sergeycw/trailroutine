// Messages between engine.ts and the engine worker are global types, not a module: the worker is classic, and
// even `import type` makes Vite in dev add `export {}` to it (engine.worker.ts).
// Route requests go one at a time (the queue in engine.ts); the id keeps the responses of different requests apart.
declare namespace EngineProtocol {
    // Engine paths. CheerpJ `/app/` is the page origin root (not the directory /next/): `/app/brouter-wasm/lib/x.jar`
    // is read as GET /brouter-wasm/lib/x.jar with Range requests (AGENTS.md, «Движок в браузере (CheerpJ)»).
    interface Paths {
        runtimeUrl: string;
        classpath: string;
        segmentDir: string;
        profileDir: string;
    }

    type ToWorker = { type: 'start'; paths: Paths } | { type: 'route'; id: number; query: string };

    type FromWorker =
        | { type: 'started' }
        | { type: 'start-failed'; message: string }
        | { type: 'routed'; id: number; geojson: string }
        | { type: 'route-failed'; id: number; message: string };
}
