import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import md5 from 'blueimp-md5';
import {defineConfig} from 'vitest/config';

// A stub of the author's storage tracks.nakarte.me (change import-nakarte-storage-links); test/tracks.test.js has the
// same bodies and keys. The tests read the number of requests to the stub through https://stub.test/calls.
const NAKARTE_BODY = 'nakarteTrack';
const NAKARTE_KEY = btoa(md5(NAKARTE_BODY, null, true)).replace(/\//gu, '_').replace(/\+/gu, '-').replace(/=/gu, '');
const FOREIGN_KEY = 'F'.repeat(22);
const ERROR_KEY = 'E'.repeat(22);
const OFFLINE_KEY = 'N'.repeat(22);
let nakarteCalls = 0;

function upstream(request) {
    const url = new URL(request.url);
    if (url.host === 'stub.test' && url.pathname === '/calls') {
        return Response.json({nakarte: nakarteCalls});
    }
    if (url.host !== 'tracks.nakarte.me') {
        return new Response('unexpected request in test', {status: 599});
    }
    nakarteCalls += 1;
    const key = url.pathname.replace('/track/', '');
    if (key === NAKARTE_KEY) {
        return new Response(NAKARTE_BODY);
    }
    if (key === FOREIGN_KEY) {
        return new Response('otherBody');
    }
    if (key === ERROR_KEY) {
        return new Response('error', {status: 500});
    }
    if (key === OFFLINE_KEY) {
        throw new Error('network is down');
    }
    return new Response('not found', {status: 404});
}

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.toml'},
            // the rate limits are lower (all requests 3, writes 2), so a few requests are sufficient to check `429`;
            // `namespace_id` is the field name of miniflare, camelCase is not possible here
            miniflare: {
                outboundService: upstream,
                ratelimits: {
                    RATE_LIMITER: {namespace_id: '1003', simple: {limit: 3, period: 60}},
                    WRITE_RATE_LIMITER: {namespace_id: '1006', simple: {limit: 2, period: 60}},
                },
            },
        }),
    ],
});
