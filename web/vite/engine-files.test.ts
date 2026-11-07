import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { copyEngineFiles, engineFilesMiddleware, parseRange } from './engine-files.ts';

// CheerpJ gets the file size from the Content-Range of the answer to Range: bytes=0-0 and without 206 does not see
// the file, so the dev server must answer as functions/brouter-wasm does in production.
describe('Файлы движка в dev-сервере', () => {
    let root: string;
    let server: Server;
    let base: string;

    beforeAll(async () => {
        root = mkdtempSync(path.join(tmpdir(), 'engine-files-'));
        mkdirSync(path.join(root, 'lib'));
        writeFileSync(path.join(root, 'lib', 'brouter.jar'), '0123456789');
        writeFileSync(path.join(root, 'secret.txt'), 'secret');
        const middleware = engineFilesMiddleware([['/brouter-wasm/lib/', path.join(root, 'lib')]]);
        server = createServer((req, res) =>
            middleware(req, res, () => {
                res.statusCode = 418;
                res.end();
            }),
        );
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(() => {
        server.close();
        rmSync(root, { recursive: true });
    });

    test('Range: первый байт — 206 и размер в Content-Range', async () => {
        const response = await fetch(`${base}/brouter-wasm/lib/brouter.jar`, { headers: { Range: 'bytes=0-0' } });
        expect(response.status).toBe(206);
        expect(response.headers.get('content-range')).toBe('bytes 0-0/10');
        expect(await response.text()).toBe('0');
    });

    test('Range: кусок и суффикс', async () => {
        const middle = await fetch(`${base}/brouter-wasm/lib/brouter.jar`, { headers: { Range: 'bytes=3-5' } });
        expect(await middle.text()).toBe('345');
        const tail = await fetch(`${base}/brouter-wasm/lib/brouter.jar`, { headers: { Range: 'bytes=-2' } });
        expect(tail.headers.get('content-range')).toBe('bytes 8-9/10');
        expect(await tail.text()).toBe('89');
    });

    test('Range за концом файла — 416', async () => {
        const response = await fetch(`${base}/brouter-wasm/lib/brouter.jar`, { headers: { Range: 'bytes=20-' } });
        expect(response.status).toBe(416);
        expect(response.headers.get('content-range')).toBe('bytes */10');
    });

    test('Без Range — весь файл', async () => {
        const response = await fetch(`${base}/brouter-wasm/lib/brouter.jar`);
        expect(response.status).toBe(200);
        expect(response.headers.get('accept-ranges')).toBe('bytes');
        expect(await response.text()).toBe('0123456789');
    });

    test('Нет файла и выход за каталог — 404', async () => {
        expect((await fetch(`${base}/brouter-wasm/lib/missing.jar`)).status).toBe(404);
        expect((await fetch(`${base}/brouter-wasm/lib/%2e%2e%2fsecret.txt`)).status).toBe(404);
    });

    test('storageconfig.txt пустой, как у functions/tiles', async () => {
        const response = await fetch(`${base}/brouter-wasm/segments4/storageconfig.txt`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('');
    });

    test('Чужие пути — дальше по цепочке Vite', async () => {
        expect((await fetch(`${base}/`)).status).toBe(418);
    });
});

describe('parseRange', () => {
    test('как functions/brouter-wasm', () => {
        expect(parseRange(undefined, 10)).toBeNull();
        expect(parseRange('bytes=-', 10)).toBeNull();
        expect(parseRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
        expect(parseRange('bytes=2-100', 10)).toEqual({ start: 2, end: 9 });
        expect(parseRange('bytes=-100', 10)).toEqual({ start: 0, end: 9 });
        expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
        expect(parseRange('items=0-1', 10)).toBeNull();
    });
});

describe('Файлы движка в сборке', () => {
    test('каталоги копируются под свои пути, отсутствующие возвращаются', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'engine-build-'));
        try {
            mkdirSync(path.join(root, 'lib', 'nested'), { recursive: true });
            writeFileSync(path.join(root, 'lib', 'nested', 'brouter.jar'), 'jar');
            const out = path.join(root, 'build');
            const missing = copyEngineFiles(out, [
                ['/brouter-wasm/lib/', path.join(root, 'lib')],
                ['/brouter-wasm/profiles/', path.join(root, 'profiles')],
            ]);
            expect(readFileSync(path.join(out, 'brouter-wasm', 'lib', 'nested', 'brouter.jar'), 'utf8')).toBe('jar');
            expect(missing).toEqual([path.join(root, 'profiles')]);
        } finally {
            rmSync(root, { recursive: true });
        }
    });
});
