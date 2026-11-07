import md5 from 'blueimp-md5';
import {env} from 'cloudflare:test';
import {exports as workerExports} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import fixture from './fixtures/client-track.json';

const CLONE_ORIGIN = 'https://nakarte-routing.pages.dev';

function clientKey(serialized) {
    const hashDigest = md5(serialized, null, true);
    return btoa(hashDigest).replace(/\//gu, '_').replace(/\+/gu, '-').replace(/=/gu, '');
}

function request(path, {method = 'GET', body, origin = CLONE_ORIGIN, headers = {}} = {}) {
    const allHeaders = {...headers};
    if (origin) {
        allHeaders.Origin = origin;
    }
    return workerExports.default.fetch(`https://tracks.test${path}`, {method, body, headers: allHeaders});
}

function postTrack(key, body, options = {}) {
    return request(`/track/${key}`, {method: 'POST', body, ...options});
}

describe('POST /track/{key}', () => {
    it('stores a new track', async () => {
        const body = 'newTrack';
        const key = clientKey(body);
        const response = await postTrack(key, body);
        expect(response.status).toBe(200);
        const stored = await env.TRACKS.get(`tracks/${key}`);
        expect(await stored.text()).toBe(body);
    });

    it('answers 200 on repeated write and keeps the stored object', async () => {
        const body = 'repeatedTrack';
        const key = clientKey(body);
        await postTrack(key, body);
        const {uploaded} = await env.TRACKS.head(`tracks/${key}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const response = await postTrack(key, body);
        expect(response.status).toBe(200);
        expect((await env.TRACKS.head(`tracks/${key}`)).uploaded).toEqual(uploaded);
    });

    it('rejects a key of another body with 400 and stores nothing', async () => {
        const keyOfB = clientKey('trackB');
        const response = await postTrack(keyOfB, 'trackA');
        expect(response.status).toBe(400);
        expect(await env.TRACKS.head(`tracks/${keyOfB}`)).toBeNull();
    });

    it('keeps the original body when a forged write targets its key', async () => {
        const keyOfB = clientKey('trackB');
        await postTrack(keyOfB, 'trackB');
        const response = await postTrack(keyOfB, 'trackA');
        expect(response.status).toBe(400);
        expect(await (await env.TRACKS.get(`tracks/${keyOfB}`)).text()).toBe('trackB');
    });

    for (const key of ['short', 'a'.repeat(23), 'aaaaaaaaaaaaaaaaaaaa%3D', 'aaaaaaaaaaaaaaaaaaaaa=']) {
        it(`rejects malformed key ${key} with 400`, async () => {
            const response = await postTrack(key, 'track');
            expect(response.status).toBe(400);
        });
    }

    it('rejects a body over 2 MiB with 413 and stores nothing', async () => {
        const body = 'x'.repeat(2 * 1024 * 1024 + 1);
        const key = clientKey(body);
        const response = await postTrack(key, body);
        expect(response.status).toBe(413);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(await env.TRACKS.head(`tracks/${key}`)).toBeNull();
    });

    it('rejects a streamed body over 2 MiB without Content-Length', async () => {
        const chunk = new Uint8Array(1024 * 1024).fill(120);
        let sent = 0;
        const body = new ReadableStream({
            pull(controller) {
                if (sent > 10) {
                    controller.close();
                    return;
                }
                sent += 1;
                controller.enqueue(chunk);
            },
        });
        const response = await workerExports.default.fetch('https://tracks.test/track/aaaaaaaaaaaaaaaaaaaaaa', {
            method: 'POST',
            body,
            duplex: 'half',
            headers: {Origin: CLONE_ORIGIN},
        });
        expect(response.status).toBe(413);
    });

    it('accepts a body of exactly 2 MiB', async () => {
        const body = 'y'.repeat(2 * 1024 * 1024);
        const response = await postTrack(clientKey(body), body);
        expect(response.status).toBe(200);
    });
});

describe('link body', () => {
    it('stores tracks joined by / with base64url padding', async () => {
        const body = `${fixture.serialized}/${fixture.serialized}==`;
        const response = await postTrack(clientKey(body), body);
        expect(response.status).toBe(200);
    });

    for (const body of ['two words', 'line\nbreak', 'percent%20', 'тропа']) {
        it(`rejects ${JSON.stringify(body)} with 400 and stores nothing`, async () => {
            const key = clientKey(body);
            const response = await postTrack(key, body);
            expect(response.status).toBe(400);
            expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
            expect(await env.TRACKS.head(`tracks/${key}`)).toBeNull();
        });
    }

    it('stores the write time in custom metadata', async () => {
        const before = Date.now();
        const body = 'createdTrack';
        await postTrack(clientKey(body), body);
        const object = await env.TRACKS.head(`tracks/${clientKey(body)}`);
        const created = Date.parse(object.customMetadata.created);
        expect(created).toBeGreaterThanOrEqual(before - 1000);
        expect(created).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('stores the nktk versions of the body in custom metadata', async () => {
        // a real version 4 string (the track Mtatsminda of the web e2e) and a version 3 head: bytes 0x43 0x00 0x00
        const v4 = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';
        const v3 = 'QwAA';
        const body = `${v4}/${v3}/${v4}`;
        await postTrack(clientKey(body), body);
        const object = await env.TRACKS.head(`tracks/${clientKey(body)}`);
        expect(object.customMetadata.nktk).toBe('3,4');
    });
});

describe('GET /track/{key}', () => {
    it('returns the stored body as text/plain', async () => {
        const body = 'storedTrack';
        const key = clientKey(body);
        await postTrack(key, body);
        const response = await request(`/track/${key}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/plain');
        expect(await response.text()).toBe(body);
    });

    it('answers 404 on an unknown key', async () => {
        const response = await request(`/track/${clientKey('never stored')}`);
        expect(response.status).toBe(404);
    });
});

// The stub of tracks.nakarte.me is in vitest.config.js, with the same bodies and keys.
describe('track from the storage of nakarte.me', () => {
    const NAKARTE_BODY = 'nakarteTrack';
    const FOREIGN_KEY = 'F'.repeat(22);
    const ERROR_KEY = 'E'.repeat(22);
    const OFFLINE_KEY = 'N'.repeat(22);

    async function nakarteCalls() {
        return (await (await fetch('https://stub.test/calls')).json()).nakarte;
    }

    it('returns a track of nakarte.me and keeps a copy with its source', async () => {
        const key = clientKey(NAKARTE_BODY);
        const response = await request(`/track/${key}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('text/plain');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(await response.text()).toBe(NAKARTE_BODY);
        const stored = await env.TRACKS.get(`tracks/${key}`);
        expect(await stored.text()).toBe(NAKARTE_BODY);
        expect(stored.customMetadata.source).toBe('nakarte.me');
        expect(Number.isNaN(Date.parse(stored.customMetadata.created))).toBe(false);
    });

    it('reads a copied track again from R2 without a request to nakarte.me', async () => {
        const key = clientKey(NAKARTE_BODY);
        await request(`/track/${key}`);
        const before = await nakarteCalls();
        const response = await request(`/track/${key}`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(NAKARTE_BODY);
        expect(await nakarteCalls()).toBe(before);
    });

    it('answers 404 when nakarte.me does not have the key either', async () => {
        const before = await nakarteCalls();
        const response = await request(`/track/${clientKey('nowhere')}`);
        expect(response.status).toBe(404);
        expect(await nakarteCalls()).toBe(before + 1);
    });

    it('answers 502 and stores nothing when the body of nakarte.me does not match the key', async () => {
        const response = await request(`/track/${FOREIGN_KEY}`);
        expect(response.status).toBe(502);
        expect(await env.TRACKS.head(`tracks/${FOREIGN_KEY}`)).toBeNull();
    });

    it('answers 502 and stores nothing when nakarte.me fails, and asks again later', async () => {
        for (const key of [ERROR_KEY, OFFLINE_KEY]) {
            const before = await nakarteCalls();
            expect((await request(`/track/${key}`)).status).toBe(502);
            expect((await request(`/track/${key}`)).status).toBe(502);
            expect(await env.TRACKS.head(`tracks/${key}`)).toBeNull();
            expect(await nakarteCalls()).toBe(before + 2);
        }
    });
});

describe('CORS', () => {
    it('reflects an allowed Origin with credentials', async () => {
        const body = 'corsTrack';
        const response = await postTrack(clientKey(body), body);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    // the own domain after the move (change move-to-trailroutine-domain): the app reads the moved data from it
    it('reflects the own domain trailroutine.com', async () => {
        const body = 'ownDomainTrack';
        await postTrack(clientKey(body), body);
        const response = await request(`/track/${clientKey(body)}`, {origin: 'https://trailroutine.com'});
        expect(response.status).toBe(200);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://trailroutine.com');
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('answers OPTIONS with 204 and allowed methods', async () => {
        const response = await request(`/track/${clientKey('x')}`, {
            method: 'OPTIONS',
            headers: {'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'},
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(response.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
    });

    it('answers 403 to a foreign Origin and stores nothing', async () => {
        const body = 'foreignTrack';
        const key = clientKey(body);
        const response = await postTrack(key, body, {origin: 'https://example.com'});
        expect(response.status).toBe(403);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
        expect(await env.TRACKS.head(`tracks/${key}`)).toBeNull();
    });

    // the dev server of the web/ app and vite preview are allowed, the ports of the old client are not
    // (change retire-old-client-services)
    it.each(['http://localhost:8769', 'http://localhost:4173'])('reflects the local app origin %s', async (origin) => {
        const response = await request(`/track/${clientKey('local')}`, {origin});
        expect(response.status).toBe(404);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    });

    it.each(['http://localhost:8765', 'http://localhost:8766'])('answers 403 to the old client origin %s', async (origin) => {
        expect((await request(`/track/${clientKey('old')}`, {origin})).status).toBe(403);
    });

    it('answers 403 without Origin', async () => {
        const response = await request(`/track/${clientKey('x')}`, {origin: null});
        expect(response.status).toBe(403);
    });
});

describe('client compatibility', () => {
    it('computes the same key as the client did', () => {
        expect(clientKey(fixture.serialized)).toBe(fixture.key);
    });

    it('accepts the key made by the client and returns the track back', async () => {
        const saved = await postTrack(fixture.key, fixture.serialized);
        expect(saved.status).toBe(200);
        const loaded = await request(`/track/${fixture.key}`);
        expect(await loaded.text()).toBe(fixture.serialized);
    });
});

describe('rate limit', () => {
    // vitest.config.js lowers the limit to 3 requests per 60 s
    const KEY = 'AAAAAAAAAAAAAAAAAAAAAA';
    function fromIp(ip, options = {}) {
        return request(`/track/${KEY}`, {...options, headers: {'CF-Connecting-IP': ip, ...options.headers}});
    }

    it('answers 429 with Retry-After and CORS after the limit, per IP', async () => {
        for (let i = 0; i < 3; i++) {
            expect((await fromIp('192.0.2.1')).status).toBe(404);
        }
        const limited = await fromIp('192.0.2.1');
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('60');
        expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
        expect(limited.headers.get('Access-Control-Allow-Credentials')).toBe('true');
        expect(await limited.text()).toBe('Too many requests\n');
        expect((await fromIp('192.0.2.2')).status).toBe(404);
    });

    it('answers 429 to writes over their own limit while the common limit is not spent', async () => {
        // vitest.config.js: the write limit is 2 per 60 s, the common limit is 3; the third POST fits the common limit
        const body = 'writeLimitTrack';
        const headers = {'CF-Connecting-IP': '192.0.2.4'};
        expect((await postTrack(clientKey(body), body, {headers})).status).toBe(200);
        expect((await postTrack(clientKey(body), body, {headers})).status).toBe(200);
        const limited = await postTrack(clientKey(body), body, {headers});
        expect(limited.status).toBe(429);
        expect(limited.headers.get('Retry-After')).toBe('60');
        expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(CLONE_ORIGIN);
    });

    it('keeps reads available after the write limit is spent', async () => {
        const body = 'readAfterWritesTrack';
        const headers = {'CF-Connecting-IP': '192.0.2.5'};
        await postTrack(clientKey(body), body, {headers});
        await postTrack(clientKey(body), body, {headers});
        expect((await request(`/track/${clientKey(body)}`, {headers})).status).toBe(200);
    });

    it('answers 403 to a foreign Origin without spending the limit', async () => {
        for (let i = 0; i < 5; i++) {
            expect((await fromIp('192.0.2.3', {origin: 'https://example.com'})).status).toBe(403);
        }
        expect((await fromIp('192.0.2.3')).status).toBe(404);
    });
});
