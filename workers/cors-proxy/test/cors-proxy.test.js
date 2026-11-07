// Прокси в workerd: CORS по списку origin, протокол адресов авторского прокси, переписывание
// редиректов. Апстрим — заглушка `outboundService` из vitest.config.js, сеть не нужна.
import {exports as workerExports} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

const CLONE_ORIGIN = 'https://nakarte-routing.pages.dev';
const PROXY = 'https://proxy.test';

function request(path, {method = 'GET', origin = CLONE_ORIGIN, headers = {}} = {}) {
    const allHeaders = {...headers};
    if (origin) {
        allHeaders.Origin = origin;
    }
    return workerExports.default.fetch(`${PROXY}${path}`, {method, headers: allHeaders, redirect: 'manual'});
}

describe('origin check', () => {
    it('answers 403 to a foreign Origin and without Origin or Referer', async () => {
        expect((await request('/https/example.com/', {origin: 'https://example.com'})).status).toBe(403);
        expect((await request('/https/example.com/', {origin: null})).status).toBe(403);
    });

    // свой домен после переезда (change move-to-trailroutine-domain)
    it('accepts the own domain trailroutine.com', async () => {
        const response = await request('/https/example.com/', {origin: 'https://trailroutine.com'});
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://trailroutine.com');
    });

    it('accepts an allowed Referer when Origin is absent', async () => {
        const response = await request('/https/example.com/', {
            origin: null,
            headers: {Referer: `${CLONE_ORIGIN}/#m=5/42/44`},
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
    });

    // dev-сервер приложения web/ и vite preview ходят в живой прокси (спека cors-proxy, «Разрешённые origin клона»)
    it.each(['http://localhost:8769', 'http://localhost:4173'])('accepts the local app origin %s', async (origin) => {
        const response = await request('/https/example.com/', {origin});
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    });

    // dev-серверы старого клиента и karma ушли вместе с ним (change retire-old-client-services)
    it.each(['http://localhost:9876', 'http://localhost:8765', 'http://localhost:8766'])(
        'rejects the old client origin %s',
        async (origin) => {
            expect((await request('/https/example.com/', {origin})).status).toBe(403);
        }
    );

    it('answers preflight with 204, methods and requested headers', async () => {
        const response = await request('/https/example.com/', {
            method: 'OPTIONS',
            headers: {'Access-Control-Request-Headers': 'content-type'},
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS');
        expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
});

describe('proxying', () => {
    it('fetches /<scheme>/<host>/<path>?<query> and returns the body with CORS', async () => {
        const response = await request('/https/www.openstreetmap.org/api/0.6/map?bbox=1,2,3,4', {
            headers: {'Accept': 'text/xml', 'Cookie': 'secret=1', 'X-Custom': 'drop'},
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Content-Disposition');
        expect(response.headers.get('X-Upstream')).toBe('yes');
        expect(response.headers.get('Set-Cookie')).toBeNull();
        const echo = await response.json();
        expect(echo.url).toBe('https://www.openstreetmap.org/api/0.6/map?bbox=1,2,3,4');
        expect(echo.headers.accept).toBe('text/xml');
        expect(echo.headers.cookie).toBeUndefined();
        expect(echo.headers['x-custom']).toBeUndefined();
    });

    it('answers 404 to the old /wikimapia/ alias', async () => {
        expect((await request('/wikimapia/z1/itiles/0/1/2.xy?123')).status).toBe(404);
    });

    it('sends HEAD upstream as GET and returns no body', async () => {
        const response = await request('/https/mapy.com/s/favepemeko', {method: 'HEAD'});
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Upstream-Method')).toBe('GET');
        expect(await response.text()).toBe('');
    });

    it('forwards User-Agent', async () => {
        const echo = await (
            await request('/https/example.com/track.gpx', {headers: {'User-Agent': 'Browser/1.0'}})
        ).json();
        expect(echo.headers['user-agent']).toBe('Browser/1.0');
    });

    it('rewrites Location of a redirect back through the proxy', async () => {
        const response = await request('/https/example.com/redirect');
        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toBe(`${PROXY}/https/example.com/moved?page=2`);
    });

    it('answers 404 with CORS to an unknown path', async () => {
        const response = await request('/ftp/example.com/file');
        expect(response.status).toBe(404);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
    });
});

describe('read only', () => {
    async function offsiteCalls() {
        return (await (await fetch('https://stub.test/calls')).json()).offsite;
    }

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        it(`answers ${method} with 405 and CORS without calling the target`, async () => {
            const before = await offsiteCalls();
            const response = await workerExports.default.fetch(`${PROXY}/https/evil.test/collect`, {
                method,
                body: method === 'DELETE' ? null : 'user=a&password=b',
                headers: {Origin: CLONE_ORIGIN},
            });
            expect(response.status).toBe(405);
            expect(response.headers.get('Allow')).toBe('GET, HEAD, OPTIONS');
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
            expect(await offsiteCalls()).toBe(before);
        });
    }
});

describe('own hosts', () => {
    for (const path of [
        '/https/nakarte-routing.pages.dev/tiles/E40_N40.rd5',
        '/https/762b3e5f.nakarte-routing.pages.dev/tiles/E40_N40.rd5',
        '/https/nakarte-elevation.nakarte-routing.workers.dev/tiles/0/0/0',
        '/http/nakarte-tracks.nakarte-routing.workers.dev/track/x',
        '/https/trailroutine.com/tiles/E40_N40.rd5',
        '/https/www.trailroutine.com/',
    ]) {
        it(`answers 403 to ${path}`, async () => {
            const response = await request(path);
            expect(response.status).toBe(403);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
            expect(response.headers.get('X-Upstream')).toBeNull();
        });
    }

    it('still proxies hosts that only look similar', async () => {
        const response = await request('/https/nakarte-routing.pages.dev.example.com/');
        expect(response.status).toBe(200);
        expect((await request('/https/trailroutine.com.example.com/')).status).toBe(200);
    });
});

describe('rate limit', () => {
    // в vitest.config.js лимиты понижены: хосты слоёв — 3, остальные — 2 запроса за 60 с
    const LAYER_TILE = '/https/maptiles.website.yandexcloud.net/12/2557/1514.png';
    function fromIp(ip, options = {}, path = LAYER_TILE) {
        return request(path, {...options, headers: {'CF-Connecting-IP': ip, ...options.headers}});
    }

    it('counts other hosts separately from layer tiles', async () => {
        const other = '/https/example.com/track.gpx';
        expect((await fromIp('192.0.2.4', {}, other)).status).toBe(200);
        expect((await fromIp('192.0.2.4', {}, other)).status).toBe(200);
        const limited = await fromIp('192.0.2.4', {}, other);
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect((await fromIp('192.0.2.4')).status).toBe(200);
        expect((await fromIp('192.0.2.4')).status).toBe(200);
        const heatmap = '/https/content-b.strava.com/identified/globalheat/all/hot/1/0/0.png';
        expect((await fromIp('192.0.2.4', {}, heatmap)).status).toBe(200);
        expect((await fromIp('192.0.2.4')).status).toBe(429);
    });

    it('answers 429 with Retry-After and CORS after the limit, per IP', async () => {
        for (let i = 0; i < 3; i++) {
            expect((await fromIp('192.0.2.1')).status).toBe(200);
        }
        const limited = await fromIp('192.0.2.1');
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('60');
        expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(await limited.text()).toBe('Too many requests\n');
        expect((await fromIp('192.0.2.2')).status).toBe(200);
    });

    it('answers 403 to a foreign Origin without spending the limit', async () => {
        for (let i = 0; i < 5; i++) {
            expect((await fromIp('192.0.2.3', {origin: 'https://example.com'})).status).toBe(403);
        }
        expect((await fromIp('192.0.2.3')).status).toBe(200);
    });

    it('does not limit requests without CF-Connecting-IP', async () => {
        for (let i = 0; i < 5; i++) {
            expect((await request('/https/example.com/')).status).toBe(200);
            expect((await request(LAYER_TILE)).status).toBe(200);
        }
    });
});
