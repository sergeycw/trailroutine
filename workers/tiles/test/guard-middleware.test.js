// The limit middleware before Pages Functions: asks nakarte-guard through the binding GUARD (here a stub)
// and does not call the function above the limit; without an IP, without the binding and on a failure it lets
// the request pass.
import {describe, expect, it} from 'vitest';

import {onRequest as brouterWasm} from '../../../functions/brouter-wasm/_middleware.js';
import {onRequest as tiles} from '../../../functions/tiles/_middleware.js';

function guard(status) {
    const asked = [];
    return {
        asked,
        fetch(_url, init) {
            asked.push(new Headers(init?.headers).get('X-Client-IP'));
            if (status === 'throw') {
                return Promise.reject(new Error('guard down'));
            }
            return Promise.resolve(new Response(null, {status}));
        },
    };
}

function call(middleware, {ip = '192.0.2.1', env = {}} = {}) {
    const headers = ip ? {'CF-Connecting-IP': ip} : {};
    let nextCalls = 0;
    const context = {
        request: new Request('https://clone.test/tiles/E40_N40.rd5', {headers}),
        env,
        next() {
            nextCalls += 1;
            return Promise.resolve(new Response('tile', {status: 206}));
        },
    };
    return middleware(context).then((response) => ({response, nextCalls}));
}

describe('guard middleware', () => {
    for (const [name, middleware] of [
        ['tiles', tiles],
        ['brouter-wasm', brouterWasm],
    ]) {
        it(`${name}: answers 429 over the limit without calling the function`, async () => {
            const GUARD = guard(429);
            const {response, nextCalls} = await call(middleware, {env: {GUARD}});
            expect(response.status).toBe(429);
            expect(response.headers.get('Retry-After')).toBe('60');
            expect(await response.text()).toBe('Too many requests\n');
            expect(nextCalls).toBe(0);
            expect(GUARD.asked).toEqual(['192.0.2.1']);
        });

        it(`${name}: calls the function within the limit`, async () => {
            const {response, nextCalls} = await call(middleware, {env: {GUARD: guard(204)}});
            expect(response.status).toBe(206);
            expect(nextCalls).toBe(1);
        });
    }

    it('passes without CF-Connecting-IP and does not ask the guard', async () => {
        const GUARD = guard(429);
        const {response} = await call(tiles, {ip: null, env: {GUARD}});
        expect(response.status).toBe(206);
        expect(GUARD.asked).toEqual([]);
    });

    it('passes without the GUARD binding', async () => {
        const {response} = await call(tiles);
        expect(response.status).toBe(206);
    });

    it('passes when the guard fails', async () => {
        const {response} = await call(tiles, {env: {GUARD: guard('throw')}});
        expect(response.status).toBe(206);
    });
});
