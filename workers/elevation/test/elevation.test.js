// Тест собранного wasm-Worker в workerd с локальным R2: адаптер `worker` (R2 range, кеш в памяти,
// перевод ответа ядра в Response) и CORS. Логику ядра подробно проверяют cargo-тесты.
import {env} from 'cloudflare:test';
import {exports as workerExports} from 'cloudflare:workers';
import {beforeAll, describe, expect, it} from 'vitest';

const CLONE_ORIGIN = 'https://nakarte-routing.pages.dev';

function request({method = 'POST', body, origin = CLONE_ORIGIN, headers = {}, path = '/'} = {}) {
    const allHeaders = {...headers};
    if (origin) {
        allHeaders.Origin = origin;
    }
    return workerExports.default.fetch(`https://elevation.test${path}`, {method, body, headers: allHeaders});
}

function referenceLines() {
    return env.FIXTURE_REFERENCE.trim()
        .split('\n')
        .map((line) => line.split(' '));
}

function referenceRequestBody() {
    return referenceLines()
        .map(([lat, lng]) => `${lat} ${lng}`)
        .join('\n');
}

function referenceAnswer() {
    return referenceLines()
        .map(([, , expected]) => expected)
        .join('\n');
}

beforeAll(async () => {
    for (const [key, base64] of Object.entries(env.FIXTURE_OBJECTS)) {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        await env.DEM.put(key, bytes);
    }
});

describe('POST /', () => {
    it('answers reference points like the author service', async () => {
        const response = await request({body: referenceRequestBody()});
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe(referenceAnswer());
    });

    it('answers the same from the in-memory cache on a repeated request', async () => {
        const first = await (await request({body: '43.350000 42.440000\n42.700000 44.500000'})).text();
        const second = await (await request({body: '43.350000 42.440000\n42.700000 44.500000'})).text();
        expect(first).toBe('5571.00\n4449.00');
        expect(second).toBe(first);
    });

    it('answers an empty body with an empty 200', async () => {
        const response = await request({body: ''});
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('');
    });

    it('rejects garbage with 400', async () => {
        const response = await request({body: 'abc def'});
        expect(response.status).toBe(400);
        expect(await response.text()).toBe('Invalid request\n');
    });

    it('rejects more than 10 000 points with 413', async () => {
        const response = await request({body: '1 2\n'.repeat(10001)});
        expect(response.status).toBe(413);
    });

    it('rejects a body over 250 000 bytes with 413', async () => {
        const response = await request({body: '1'.repeat(250001)});
        expect(response.status).toBe(413);
    });
});

describe('CORS and methods', () => {
    it.each(['http://localhost:8769', 'http://localhost:4173'])('reflects the allowed origin %s with credentials', async (origin) => {
        const response = await request({body: '43.35 42.44', origin});
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(response.headers.get('Vary')).toBe('Origin');
    });

    it('answers preflight with 204', async () => {
        const response = await request({
            method: 'OPTIONS',
            headers: {'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'},
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
        expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
    });

    // свой домен после переезда (change move-to-trailroutine-domain)
    it('reflects the own domain trailroutine.com', async () => {
        const response = await request({body: '', origin: 'https://trailroutine.com'});
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://trailroutine.com');
    });

    it('rejects a foreign origin and a missing origin with 403', async () => {
        expect((await request({body: '1 2', origin: 'https://example.com'})).status).toBe(403);
        expect((await request({body: '1 2', origin: null})).status).toBe(403);
    });

    it('answers GET with 405', async () => {
        const response = await request({method: 'GET'});
        expect(response.status).toBe(405);
        expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    });

    it('answers other paths with 404', async () => {
        expect((await request({body: '1 2', path: '/elevation'})).status).toBe(404);
    });
});
