import { describe, expect, test } from 'vitest';
import { workerBackend } from './backends';
import { enginePaths } from './cheerpj-router';

// The protocol between engine.ts and the engine worker on a fake worker: the same message exchange as in
// engine.worker.ts, but without CheerpJ. Requests: 'fail' in the runtime URL is a start failure, 'bad' is a route
// error, 'crash' is an unhandled exception in the worker, any other request gives an echo.
const FAKE_WORKER = `
addEventListener('message', ({ data }) => {
    if (data.type === 'start') {
        postMessage(data.paths.runtimeUrl === 'fail' ? { type: 'start-failed', message: 'no runtime' } : { type: 'started' });
        return;
    }
    if (data.query === 'crash') {
        throw new Error('worker crashed');
    }
    if (data.query === 'bad') {
        postMessage({ type: 'route-failed', id: data.id, message: 'no route found' });
        return;
    }
    postMessage({ type: 'routed', id: data.id, geojson: 'route:' + data.query });
});
`;

const fakeWorker = () => new Worker(URL.createObjectURL(new Blob([FAKE_WORKER], { type: 'text/javascript' })));

describe('Протокол воркера движка', () => {
    test('старт и маршруты', async () => {
        const backend = workerBackend(enginePaths('ok', '/tiles/'), fakeWorker);
        await backend.start();
        const [a, b] = await Promise.all([backend.route('a'), backend.route('b')]);
        expect([a, b]).toEqual(['route:a', 'route:b']);
        await expect(backend.route('bad')).rejects.toThrow('no route found');
        // a route error does not break the worker
        await expect(backend.route('c')).resolves.toBe('route:c');
        backend.dispose();
    });

    test('сбой старта', async () => {
        const backend = workerBackend(enginePaths('fail', '/tiles/'), fakeWorker);
        await expect(backend.start()).rejects.toThrow('no runtime');
        backend.dispose();
    });

    test('падение воркера отклоняет ожидающие запросы', async () => {
        const backend = workerBackend(enginePaths('ok', '/tiles/'), fakeWorker);
        await backend.start();
        await expect(backend.route('crash')).rejects.toThrow('worker crashed');
        backend.dispose();
    });

    test('завершение воркера отклоняет ожидающие запросы', async () => {
        const backend = workerBackend(enginePaths('ok', '/tiles/'), fakeWorker);
        await backend.start();
        const pending = backend.route('a');
        backend.dispose();
        await expect(pending).rejects.toThrow('engine worker terminated');
        await expect(backend.route('b')).rejects.toThrow('engine is not started');
    });

    test('пути движка от корня origin', () => {
        const paths = enginePaths('ok', '/tiles/');
        expect(paths.segmentDir).toBe('/app/tiles/');
        expect(paths.profileDir).toBe('/app/brouter-wasm/profiles/');
        expect(paths.classpath).toBe(
            '/app/brouter-wasm/lib/brouter-patch.jar:/app/brouter-wasm/lib/brouter.jar:/app/brouter-wasm/lib/wasm-router.jar',
        );
    });
});
