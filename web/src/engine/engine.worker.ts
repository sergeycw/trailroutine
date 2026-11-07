// The engine worker. Classic, not a module: the CheerpJ loader declares cheerpjInit as a global function
// and connects only through importScripts (CheerpJ documentation, «Migration from CheerpJ 2»: CheerpJWorker
// is removed, a worker uses importScripts). Vite in dev serves the worker almost as is: an import in a classic
// worker fails with «Cannot use import statement outside a module», and after `import type` Vite keeps
// `export {}` («Unexpected token 'export'»). So there are no imports at all, the message types are global
// (protocol.d.ts), and the CheerpJ wrapper repeats loadRouter from cheerpj-router.ts: change one, change both.
// tsconfig builds the app with lib DOM, not WebWorker, so the worker globals are declared manually.
declare function importScripts(...urls: string[]): void;
declare function postMessage(message: EngineProtocol.FromWorker): void;
declare function cheerpjInit(options: { version: number; status: string }): Promise<void>;
declare function cheerpjRunLibrary(classpath: string): Promise<{ WasmRouter: Promise<WasmRouterClass> }>;

interface WasmRouterClass {
    route(segmentDir: string, profileDir: string, query: string): Promise<unknown>;
}

type RouteFn = (query: string) => Promise<string>;

async function javaErrorMessage(error: unknown): Promise<string> {
    try {
        const message = await (error as { getMessage(): Promise<unknown> }).getMessage();
        if (message != null) {
            return String(message);
        }
    } catch {
        // not a Java exception
    }
    return error instanceof Error ? error.message : String(error);
}

async function loadRouter(paths: EngineProtocol.Paths): Promise<RouteFn> {
    importScripts(paths.runtimeUrl);
    await cheerpjInit({ version: 11, status: 'none' });
    const lib = await cheerpjRunLibrary(paths.classpath);
    const router = await lib.WasmRouter;
    return async (query) => {
        try {
            return String(await router.route(paths.segmentDir, paths.profileDir, query));
        } catch (error) {
            throw new Error(await javaErrorMessage(error));
        }
    };
}

function text(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

let router: Promise<RouteFn> | null = null;

async function start(paths: EngineProtocol.Paths) {
    router ??= loadRouter(paths);
    try {
        await router;
        postMessage({ type: 'started' });
    } catch (error) {
        router = null;
        postMessage({ type: 'start-failed', message: text(error) });
    }
}

async function route(id: number, query: string) {
    try {
        if (!router) {
            throw new Error('engine is not started');
        }
        const geojson = await (await router)(query);
        postMessage({ type: 'routed', id, geojson });
    } catch (error) {
        postMessage({ type: 'route-failed', id, message: text(error) });
    }
}

addEventListener('message', (event) => {
    const message = (event as MessageEvent<EngineProtocol.ToWorker>).data;
    if (message.type === 'start') {
        void start(message.paths);
        return;
    }
    void route(message.id, message.query);
});
