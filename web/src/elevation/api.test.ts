import { describe, expect, it, vi } from 'vitest';
import { ELEVATION_CHUNK, ElevationError, fetchElevations, parseResponse, requestBody, requestLng } from './api';

const URL = 'https://elevation.example.test/';
const P = (lat: number, lng: number) => ({ lat, lng });

// An in-memory elevation API: the elevation of a point is the latitude × 100, points south of the equator give NULL
function fakeApi() {
    const bodies: string[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = String(init?.body ?? '');
        bodies.push(body);
        const lines = body.split('\n').map((line) => {
            const lat = Number.parseFloat(line);
            return lat < 0 ? 'NULL' : (lat * 100).toFixed(2);
        });
        return new Response(lines.join('\n'));
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, bodies, calls: fetch };
}

describe('requestBody', () => {
    it('строки «lat lng» с шестью знаками, долгота за 180° — в пределах', () => {
        expect(requestBody([P(43.35, 42.44), P(-1, 190), P(0, 180), P(0, -180)])).toBe(
            '43.350000 42.440000\n-1.000000 -170.000000\n0.000000 -180.000000\n0.000000 -180.000000',
        );
        expect(requestLng(44.8)).toBe(44.8);
    });
});

describe('parseResponse', () => {
    it('высоты и NULL', () => {
        expect(parseResponse('5571.00\nNULL', 2)).toEqual([5571, null]);
        expect(parseResponse('', 0)).toEqual([]);
    });

    it('число строк не совпало — ошибка', () => {
        expect(() => parseResponse('1.00', 2)).toThrow('unexpected response');
        expect(() => parseResponse('abc', 1)).toThrow(ElevationError);
    });
});

describe('fetchElevations', () => {
    it('POST на адрес сервиса без credentials, ответ по точкам', async () => {
        const api = fakeApi();
        const values = await fetchElevations([P(10, 1), P(-5, 2)], { fetch: api.fetch, url: URL });
        expect(values).toEqual([1000, null]);
        expect(api.calls).toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'POST' }));
        expect(api.calls.mock.calls[0][1]).not.toHaveProperty('credentials');
    });

    it('куски по 10 000 точек по порядку', async () => {
        const api = fakeApi();
        const points = Array.from({ length: ELEVATION_CHUNK * 2 + 5 }, (_, i) => P(i / 1000, 0));
        const values = await fetchElevations(points, { fetch: api.fetch, url: URL });
        expect(api.bodies.map((body) => body.split('\n').length)).toEqual([ELEVATION_CHUNK, ELEVATION_CHUNK, 5]);
        expect(values).toHaveLength(points.length);
        expect(values.at(-1)).toBeCloseTo(((ELEVATION_CHUNK * 2 + 4) / 1000) * 100, 2);
    });

    it('пустой список — без запросов', async () => {
        const api = fakeApi();
        expect(await fetchElevations([], { fetch: api.fetch, url: URL })).toEqual([]);
        expect(api.calls).not.toHaveBeenCalled();
    });

    it.each([
        [429, 'too many requests, try again in a minute'],
        [413, 'track covers too large an area'],
        [500, 'HTTP 500'],
    ])('ответ %i — причина «%s»', async (status, reason) => {
        const fetch = (async () => new Response('x', { status })) as typeof globalThis.fetch;
        await expect(fetchElevations([P(1, 1)], { fetch, url: URL })).rejects.toThrow(reason);
    });

    it('ошибка сети', async () => {
        const fetch = (async () => {
            throw new TypeError('Failed to fetch');
        }) as typeof globalThis.fetch;
        await expect(fetchElevations([P(1, 1)], { fetch, url: URL })).rejects.toThrow(
            new ElevationError('network error'),
        );
    });

    it('отменённый запрос — ошибка отмены, а не сети', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
            init?.signal?.throwIfAborted();
            return new Response('');
        }) as typeof globalThis.fetch;
        await expect(fetchElevations([P(1, 1)], { fetch, url: URL }, controller.signal)).rejects.not.toBeInstanceOf(
            ElevationError,
        );
    });
});
