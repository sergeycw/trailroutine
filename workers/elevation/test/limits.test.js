// The request rate from one IP in the built wasm Worker: the `[[ratelimits]]` bindings, the API counter, the R2
// read budget, `429` with CORS. vitest.config.js lowers the limits: API 2 calls and 5 budget units (64 reads
// each) per 60 s. The elevation tiles with their own counter do not exist any more (change retire-old-client-services).
import {exports as workerExports} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

const CLONE_ORIGIN = 'https://nakarte-routing.pages.dev';

function fromIp(ip, path, {method = 'GET', origin, body} = {}) {
    const headers = {'CF-Connecting-IP': ip};
    if (origin) {
        headers.Origin = origin;
    }
    return workerExports.default.fetch(`https://elevation.test${path}`, {method, headers, body});
}

function api(ip, origin = CLONE_ORIGIN) {
    return fromIp(ip, '/', {method: 'POST', origin, body: ''});
}

describe('rate limit', () => {
    it('does not spend the API counter on the former tiles route', async () => {
        for (let i = 0; i < 4; i++) {
            expect((await fromIp('192.0.2.2', '/tiles/11/796/844')).status).toBe(403);
        }
        expect((await api('192.0.2.2')).status).toBe(200);
    });

    it('answers 429 to the API with the reflected Origin, 403 does not spend it', async () => {
        for (let i = 0; i < 3; i++) {
            expect((await api('192.0.2.3', 'https://example.com')).status).toBe(403);
        }
        for (let i = 0; i < 2; i++) {
            expect((await api('192.0.2.3')).status).toBe(200);
        }
        const limited = await api('192.0.2.3');
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(limited.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('does not limit requests without CF-Connecting-IP', async () => {
        for (let i = 0; i < 5; i++) {
            const response = await workerExports.default.fetch('https://elevation.test/', {
                method: 'POST',
                headers: {Origin: CLONE_ORIGIN},
                body: '',
            });
            expect(response.status).toBe(200);
        }
    });
});

// Points in `count` different degrees: a header and a chunk for each, thus 2 × count reads.
function scattered(count) {
    return Array.from({length: count}, (_, i) => `${(i % 100) - 49.5} ${Math.floor(i / 100) * 10 + 0.5}`).join('\n');
}

describe('reads budget', () => {
    it('answers 413 to points that touch more than 512 reads, before the budget', async () => {
        const response = await fromIp('192.0.2.10', '/', {method: 'POST', origin: CLONE_ORIGIN, body: scattered(300)});
        expect(response.status).toBe(413);
        expect(await response.text()).toBe('Request too big\n');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
    });

    it('answers 429 when the reads budget of the IP is spent', async () => {
        // 100 degrees are 200 reads, 4 units of 5
        const first = await fromIp('192.0.2.11', '/', {method: 'POST', origin: CLONE_ORIGIN, body: scattered(100)});
        expect(first.status).toBe(200);
        const second = await fromIp('192.0.2.11', '/', {method: 'POST', origin: CLONE_ORIGIN, body: scattered(100)});
        expect(second.status).toBe(429);
        expect(second.headers.get('Retry-After')).toBe('60');
        expect(second.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(second.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('does not spend the reads budget without CF-Connecting-IP', async () => {
        for (let i = 0; i < 3; i++) {
            const response = await workerExports.default.fetch('https://elevation.test/', {
                method: 'POST',
                headers: {Origin: CLONE_ORIGIN},
                body: scattered(100),
            });
            expect(response.status).toBe(200);
        }
    });
});
