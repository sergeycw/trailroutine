// The counter for Pages Functions in workerd: 204 while the IP is within the limit, then 429.
// vitest.config.js lowers the limit to 3 per 60 s.
import {exports as workerExports} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

function ask(ip) {
    const headers = ip ? {'X-Client-IP': ip} : {};
    return workerExports.default.fetch('https://guard/', {headers});
}

describe('guard', () => {
    it('answers 204 within the limit and 429 after it, per IP', async () => {
        for (let i = 0; i < 3; i++) {
            expect((await ask('192.0.2.1')).status).toBe(204);
        }
        expect((await ask('192.0.2.1')).status).toBe(429);
        expect((await ask('192.0.2.2')).status).toBe(204);
    });

    it('does not limit without X-Client-IP', async () => {
        for (let i = 0; i < 5; i++) {
            expect((await ask(null)).status).toBe(204);
        }
    });
});
