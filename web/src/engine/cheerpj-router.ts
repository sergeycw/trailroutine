// Engine paths and the CheerpJ wrapper for the fallback on the main thread. The worker (engine.worker.ts) repeats
// loadRouter: a classic worker in Vite dev cannot import anything, so a change in one copy is a change in both.
// Reference: the engine of the old client src/lib/brouter/browser-engine.js and the class WasmRouter from
// experiments/wasm/cheerpj/java/.

export type EnginePaths = EngineProtocol.Paths;

const BASE_DIR = '/app/brouter-wasm/';
const JARS = ['lib/brouter-patch.jar', 'lib/brouter.jar', 'lib/wasm-router.jar'];

export function enginePaths(runtimeUrl: string, routingTilesPath: string): EnginePaths {
    return {
        runtimeUrl,
        // brouter-patch.jar goes first: its classes replace the classes with the same names from brouter.jar
        classpath: JARS.map((jar) => BASE_DIR + jar).join(':'),
        segmentDir: `/app${routingTilesPath}`,
        profileDir: `${BASE_DIR}profiles/`,
    };
}

export type RouteFn = (query: string) => Promise<string>;

interface WasmRouterClass {
    route(segmentDir: string, profileDir: string, query: string): Promise<unknown>;
}

interface CheerpjGlobals {
    cheerpjInit(options: { version: number; status: string }): Promise<void>;
    cheerpjRunLibrary(classpath: string): Promise<{ WasmRouter: Promise<WasmRouterClass> }>;
}

// A Java exception comes as a JS object with an async getMessage(). A stack overflow in CheerpJ is an
// ArithmeticException without a message (AGENTS.md), then only the name is left.
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

// cheerpjInit runs one time per global scope: a second call throws «CheerpJ: Already initialized» (checked in design
// spike-engine-in-worker). So a restart after a failure on the main thread uses the initialization that already ran and
// does not call it again.
let initialized: Promise<void> | null = null;

export async function loadRouter(loadScript: (url: string) => Promise<void>, paths: EnginePaths): Promise<RouteFn> {
    initialized ??= loadScript(paths.runtimeUrl)
        .then(() => (globalThis as unknown as CheerpjGlobals).cheerpjInit({ version: 11, status: 'none' }))
        .catch((error: unknown) => {
            initialized = null;
            throw error;
        });
    await initialized;
    const lib = await (globalThis as unknown as CheerpjGlobals).cheerpjRunLibrary(paths.classpath);
    const router = await lib.WasmRouter;
    return async (query) => {
        try {
            return String(await router.route(paths.segmentDir, paths.profileDir, query));
        } catch (error) {
            throw new Error(await javaErrorMessage(error));
        }
    };
}
