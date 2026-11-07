import {env} from 'cloudflare:test';
import {exports as workerExports} from 'cloudflare:workers';
import {beforeAll, describe, expect, it} from 'vitest';

// The tile body is the byte numbers modulo 256: the response shows which range came back.
const TILE = Uint8Array.from({length: 1000}, (_, i) => i % 256);

function request(path, {method = 'GET', headers = {}} = {}) {
    return workerExports.default.fetch(`https://clone.test${path}`, {method, headers});
}

async function bytes(response) {
    return new Uint8Array(await response.arrayBuffer());
}

beforeAll(async () => {
    await env.TILES.put('E40_N40.rd5', TILE);
});

describe('GET /tiles/<name>.rd5', () => {
    it('answers a range with 206 and Content-Range, as CheerpJ stat needs', async () => {
        const response = await request('/tiles/E40_N40.rd5', {headers: {Range: 'bytes=0-0'}});
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 0-0/1000');
        expect(response.headers.get('Content-Length')).toBe('1');
        expect(response.headers.get('Accept-Ranges')).toBe('bytes');
        expect(await bytes(response)).toEqual(TILE.slice(0, 1));
    });

    it('forbids caching: a tile is overwritten in place by the weekly sync', async () => {
        const ranged = await request('/tiles/E40_N40.rd5', {headers: {Range: 'bytes=0-0'}});
        expect(ranged.headers.get('Cache-Control')).toBe('no-store');
        const whole = await request('/tiles/E40_N40.rd5');
        expect(whole.headers.get('Cache-Control')).toBe('no-store');
        const head = await request('/tiles/E40_N40.rd5', {method: 'HEAD'});
        expect(head.headers.get('Cache-Control')).toBe('no-store');
    });

    it('answers a middle range with exactly those bytes', async () => {
        const response = await request('/tiles/E40_N40.rd5', {headers: {Range: 'bytes=300-309'}});
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 300-309/1000');
        expect(await bytes(response)).toEqual(TILE.slice(300, 310));
    });

    it('answers a suffix range', async () => {
        const response = await request('/tiles/E40_N40.rd5', {headers: {Range: 'bytes=-10'}});
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 990-999/1000');
        expect(await bytes(response)).toEqual(TILE.slice(990));
    });

    it('answers the whole tile with 200 without Range', async () => {
        const response = await request('/tiles/E40_N40.rd5');
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Length')).toBe('1000');
        expect(await bytes(response)).toEqual(TILE);
    });

    it('answers 416 to a range past the end', async () => {
        const response = await request('/tiles/E40_N40.rd5', {headers: {Range: 'bytes=2000-2010'}});
        expect(response.status).toBe(416);
    });

    it('answers 404 to a missing tile', async () => {
        const response = await request('/tiles/W180_S90.rd5', {headers: {Range: 'bytes=0-0'}});
        expect(response.status).toBe(404);
    });
});

describe('other requests', () => {
    it('answers HEAD with the size and no body', async () => {
        const response = await request('/tiles/E40_N40.rd5', {method: 'HEAD'});
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Length')).toBe('1000');
        expect(await response.text()).toBe('');
    });

    it('answers storageconfig.txt with an empty body', async () => {
        const response = await request('/tiles/storageconfig.txt');
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('');
    });

    it('answers 405 to POST', async () => {
        const response = await request('/tiles/E40_N40.rd5', {method: 'POST'});
        expect(response.status).toBe(405);
    });

    it('answers 404 to bucket keys that are not tiles', async () => {
        await env.TILES.put('manifest.json', '{"tiles": {}}');
        expect((await request('/tiles/manifest.json')).status).toBe(404);
        expect((await request('/tiles/manifest.json', {method: 'HEAD'})).status).toBe(404);
    });

    it('answers 404 outside /tiles/', async () => {
        const response = await request('/other/E40_N40.rd5');
        expect(response.status).toBe(404);
    });
});
