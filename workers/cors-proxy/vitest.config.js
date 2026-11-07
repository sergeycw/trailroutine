import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {defineConfig} from 'vitest/config';

// The CloudFront policy expiry in the Strava stub, in seconds (year 2033); test/strava.test.js has the same number.
const STRAVA_POLICY_EPOCH = 2_000_000_000;

// CloudFront-Policy is the policy JSON in base64 with the CloudFront replacements: + → -, = → _, / → ~.
function cloudFrontPolicy(epoch) {
    const json = JSON.stringify({
        Statement: [
            {
                Resource: 'https://content-*.strava.com/identified/globalheat/*',
                Condition: {DateLessThan: {'AWS:EpochTime': epoch}},
            },
        ],
    });
    return btoa(json).replace(/\+/gu, '-').replace(/[=]/gu, '_').replace(/\//gu, '~');
}

// How many times the Strava stub saw each session and how many requests got to Tracestrack; the test reads this through
// https://stub.test/calls.
const stravaCalls = new Map();
const offsiteCalls = [];
let tracestrackCalls = 0;

// The page www.strava.com/maps/global-heatmap. The value of `_strava4_session` up to the first `-` sets the
// behavior: ok, redirect, login, offsite, anon, partial, noexpiry, error; the tail makes the session unique,
// so the tests do not share the cache of the isolate.
function stravaPage(request) {
    const url = new URL(request.url);
    const session = /_strava4_session=([^;]+)/u.exec(request.headers.get('cookie') ?? '')?.[1] ?? '';
    stravaCalls.set(session, (stravaCalls.get(session) ?? 0) + 1);
    const mode = session.split('-')[0];
    const headers = new Headers({'Content-Type': 'text/html'});
    function cookie(name, value) {
        headers.append('Set-Cookie', `${name}=${value}; Domain=.strava.com; Path=/; Secure; HttpOnly`);
    }
    if (mode === 'login') {
        return new Response(null, {status: 302, headers: {Location: 'https://www.strava.com/login'}});
    }
    if (mode === 'offsite') {
        return new Response(null, {status: 302, headers: {Location: 'https://evil.test/collect'}});
    }
    if (mode === 'anon') {
        return new Response('<html></html>', {headers});
    }
    if (mode === 'error') {
        return new Response('oops', {status: 503});
    }
    if (mode === 'redirect' && !url.searchParams.has('moved')) {
        return new Response(null, {status: 302, headers: {Location: '/maps/global-heatmap?moved=1'}});
    }
    // the proxy must ignore the session rotation
    cookie('_strava4_session', 'rotated; Expires=Fri, 08 Oct 2027 00:00:00 GMT');
    cookie('_strava_CloudFront-Expires', String(STRAVA_POLICY_EPOCH * 1000));
    cookie('CloudFront-Policy', mode === 'noexpiry' ? 'not-a-policy' : cloudFrontPolicy(STRAVA_POLICY_EPOCH));
    cookie('CloudFront-Signature', `sig-${session}`);
    if (mode !== 'partial') {
        cookie('CloudFront-Key-Pair-Id', 'kp');
        cookie('_strava_idcf', `jwt-${session}`);
    }
    return new Response('<html></html>', {headers});
}

// `outboundService` replaces the upstream of the proxy: the test does not use the network. The stub echoes
// the request (address, method, headers) and gives the headers that the proxy must remove or rewrite.
function upstream(request) {
    const url = new URL(request.url);
    if (url.host === 'stub.test' && url.pathname === '/calls') {
        const session = url.searchParams.get('session');
        return Response.json({
            strava: stravaCalls.get(session) ?? 0,
            offsite: offsiteCalls.length,
            tracestrack: tracestrackCalls,
        });
    }
    if (url.host === 'www.strava.com' && url.pathname === '/maps/global-heatmap') {
        return stravaPage(request);
    }
    // Strava CloudFront: without cookies and with "dead" cookies (STRAVA_COOKIES from the test) it gives 403 MissingKey
    if (/^content-[a-z]\.strava\.com$/u.test(url.host)) {
        const cookie = request.headers.get('cookie') ?? '';
        if (!cookie || cookie.includes('CloudFront-Signature=dead')) {
            return new Response('MissingKey', {status: 403, headers: {'Content-Type': 'text/plain'}});
        }
    }
    // anonymous heatmap: an echo of the tile request, as for the other addresses, but with an image type
    if (/^heatmap-external-[abc]\.strava\.com$/u.test(url.host)) {
        return Response.json(
            {url: request.url, method: request.method, headers: Object.fromEntries(request.headers)},
            {headers: {'X-Anonymous-Tile': 'yes'}}
        );
    }
    // Tracestrack: the tile with x = 999 answers with a redirect with the key in Location, with x = 403 with a refusal
    // with the key in the body and a header, with y = 7 with its own Cache-Control; the other tiles give an echo of the
    // request (the test sees the key in it) with an extra header
    if (url.host === 'tile.tracestrack.com') {
        tracestrackCalls += 1;
        const [, , z, x, y] = url.pathname.split('/');
        if (x === '999') {
            return new Response(null, {
                status: 302,
                headers: {Location: `/topo__/${z}/1/${y}?key=${url.searchParams.get('key')}`},
            });
        }
        const key = url.searchParams.get('key');
        if (x === '403') {
            return new Response(`key ${key} is blocked`, {status: 403, headers: {Link: `<${url.href}>`}});
        }
        const cache = y.startsWith('7.') || y.startsWith('7@') ? {'Cache-Control': 'max-age=60'} : {};
        return Response.json({url: request.url}, {headers: {'X-Debug-Key': String(key), ...cache}});
    }
    if (url.host === 'evil.test') {
        offsiteCalls.push(request.url);
    }
    if (url.pathname === '/redirect') {
        return new Response(null, {status: 302, headers: {Location: '/moved?page=2'}});
    }
    return Response.json(
        {url: request.url, method: request.method, headers: Object.fromEntries(request.headers)},
        {headers: {'Set-Cookie': 'session=1', 'X-Upstream': 'yes', 'X-Upstream-Method': request.method}}
    );
}

// test/tracestrack.test.js has the same value
const TRACESTRACK_KEY = 'test-tracestrack-key';
const STRAVA_COOKIES = 'CloudFront-Key-Pair-Id=k; CloudFront-Policy=p; CloudFront-Signature=s; _strava_idcf=j';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.toml'},
            // the rate limits are lower (layers 3, other hosts 2), so a few requests are sufficient to check `429`;
            // `namespace_id` is the field name of miniflare, camelCase is not possible here
            miniflare: {
                outboundService: upstream,
                // secrets of wrangler secret put STRAVA_SESSION / STRAVA_COOKIES / TRACESTRACK_KEY; here they are stubs
                bindings: {STRAVA_SESSION: '_strava4_session=ok-worker', STRAVA_COOKIES, TRACESTRACK_KEY},
                ratelimits: {
                    RATE_LIMITER: {namespace_id: '1004', simple: {limit: 3, period: 60}},
                    OTHER_RATE_LIMITER: {namespace_id: '1007', simple: {limit: 2, period: 60}},
                },
            },
        }),
    ],
});
