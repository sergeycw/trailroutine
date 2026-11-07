import {anonymousTileUrl, heatmapCookie, isStravaHeatmap} from './strava';
import {errorBody, isTracestrackTile, responseHeaders, TRACESTRACK_HOST, withKey, withoutKey} from './tracestrack';

// user-agent: fetch in a Worker does not set its own, and some sites answer 403 without it (Wikimapia did this;
// its address /wikimapia/ was removed together with the old client, change retire-old-client-services).
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'range', 'user-agent'];
const DROPPED_RESPONSE_HEADERS = ['set-cookie'];
const EXPOSED_HEADERS = 'Content-Disposition';
// Read only: the client does not send POST through the proxy, and forwarding of bodies made the proxy an open relay
// (security audit, item 4; change restrict-cors-proxy).
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
const READ_METHODS = ['GET', 'HEAD'];
// Hosts of the tile layers of the clone that the app sends through the proxy (viaCorsProxy in
// web/src/layers/catalog.ts): Strava heatmap, Tsvetkov and Tracestrack Topo. They use RATE_LIMITER (1200 per minute).
// All other hosts (import by link, search, short links, custom layers through the proxy) use OTHER_RATE_LIMITER. A
// layer host that is missing here does not break, but it gets a lower limit.
const LAYER_HOSTS = [/^content-[a-z]\.strava\.com$/u, 'maptiles.website.yandexcloud.net', TRACESTRACK_HOST];
// Own addresses of the clone: Workers of the account already answer a subrequest with error 1042; Pages does not.
const OWN_HOSTS = [/(^|\.)nakarte-routing\.workers\.dev$/u, /(^|\.)nakarte-routing\.pages\.dev$/u, /(^|\.)trailroutine\.com$/u];
// When CloudFront gives these answers to a tile with cookies, the proxy tries the anonymous tile: the cookies expired
// or CloudFront did not accept them.
const STRAVA_REJECTED = [401, 403];
// The window length of `[[ratelimits]]` in wrangler.toml.
const RETRY_AFTER_SECONDS = '60';

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function callerOrigin(request, allowed) {
    const origin = request.headers.get('Origin');
    if (origin) {
        return allowed.includes(origin) ? origin : null;
    }
    const referer = request.headers.get('Referer');
    if (!referer) {
        return null;
    }
    try {
        const refererOrigin = new URL(referer).origin;
        return allowed.includes(refererOrigin) ? refererOrigin : null;
    } catch {
        return null;
    }
}

function targetUrl(url) {
    const match = url.pathname.match(/^\/(https?)\/(.+)$/u);
    if (!match) {
        return null;
    }
    return `${match[1]}://${match[2]}${url.search}`;
}

function proxiedUrl(proxyOrigin, absoluteUrl) {
    const url = new URL(absoluteUrl);
    return `${proxyOrigin}/${url.protocol.slice(0, -1)}/${url.host}${url.pathname}${url.search}`;
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Expose-Headers': EXPOSED_HEADERS,
        'Vary': 'Origin',
    };
}

function hostMatches(hostname, patterns) {
    return patterns.some((pattern) => (typeof pattern === 'string' ? pattern === hostname : pattern.test(hostname)));
}

// The counter depends on the target role; without a parsed target (404) it is the layer counter, as before the split.
function limiterFor(env, target) {
    if (!target || hostMatches(new URL(target).hostname, LAYER_HOSTS)) {
        return env.RATE_LIMITER;
    }
    return env.OTHER_RATE_LIMITER;
}

// Without CF-Connecting-IP (local wrangler dev, tests) the rate is not limited.
async function overLimit(request, limiter) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) {
        return false;
    }
    const {success} = await limiter.limit({key: ip});
    return !success;
}

function tooManyRequests(origin) {
    return new Response('Too many requests\n', {
        status: 429,
        headers: {...corsHeaders(origin), 'Retry-After': RETRY_AFTER_SECONDS},
    });
}

function preflight(request, origin) {
    const headers = new Headers(corsHeaders(origin));
    headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS);
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    if (requestedHeaders) {
        headers.set('Access-Control-Allow-Headers', requestedHeaders);
    }
    return new Response(null, {status: 204, headers});
}

async function proxy(request, env, ctx, origin, target, proxyOrigin) {
    // without the key, the proxy never requests a Tracestrack tile: the client gets an error and falls back to OSM
    const tracestrack = isTracestrackTile(target);
    if (tracestrack && !env.TRACESTRACK_KEY) {
        return new Response('Tracestrack key is not set\n', {status: 503, headers: corsHeaders(origin)});
    }
    const upstreamTarget = tracestrack ? withKey(target, env.TRACESTRACK_KEY) : target;
    const upstreamHeaders = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
        const value = request.headers.get(name);
        if (value) {
            upstreamHeaders.set(name, value);
        }
    }
    // the Strava cookies go only to heatmap tiles; the proxy never forwards the cookie of the client (src/strava.js)
    const strava = isStravaHeatmap(target) ? await heatmapCookie(env, ctx) : null;
    if (strava?.cookie) {
        upstreamHeaders.set('cookie', strava.cookie);
    }
    // HEAD goes to the service as GET, as in the nginx proxy of the author (proxy_cache_convert_head):
    // short links of mapy.com answer 404 to HEAD, but answer GET with the redirect that the client needs.
    const isHead = request.method === 'HEAD';
    function send(url) {
        return fetch(url, {method: 'GET', headers: upstreamHeaders, redirect: 'manual'});
    }
    // if cookies are absent or rejected, the proxy gets a z≤12 tile without cookies from the anonymous Strava address
    const anonymous = strava ? anonymousTileUrl(target) : null;
    let stravaSource = strava?.source;
    let upstream = null;
    if (anonymous && stravaSource === 'none') {
        upstream = await send(anonymous);
        stravaSource = 'anonymous';
    } else {
        upstream = await send(upstreamTarget);
    }
    if (anonymous && stravaSource !== 'anonymous' && STRAVA_REJECTED.includes(upstream.status)) {
        await upstream.body?.cancel();
        upstreamHeaders.delete('cookie');
        upstream = await send(anonymous);
        stravaSource = 'anonymous';
    }
    if (isHead) {
        await upstream.body?.cancel();
    }

    const headers = tracestrack ? responseHeaders(upstream) : new Headers(upstream.headers);
    for (const name of DROPPED_RESPONSE_HEADERS) {
        headers.delete(name);
    }
    for (const [name, value] of Object.entries(corsHeaders(origin))) {
        headers.set(name, value);
    }
    // the source of the tile cookies (session, fallback, anonymous, none), to check STRAVA_SESSION
    if (strava) {
        headers.set('X-Strava-Cookies', stravaSource);
    }
    const location = upstream.headers.get('Location');
    if (location) {
        const absolute = new URL(location, target).href;
        headers.set('Location', proxiedUrl(proxyOrigin, tracestrack ? withoutKey(absolute) : absolute));
    }
    let body = isHead ? null : upstream.body;
    if (tracestrack && !upstream.ok && body) {
        await upstream.body.cancel();
        body = errorBody(upstream.status);
        headers.set('Content-Type', 'text/plain;charset=UTF-8');
    }
    return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
    });
}

const worker = {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = callerOrigin(request, allowedOrigins(env));
        if (!origin) {
            return new Response('Forbidden', {status: 403});
        }
        const target = targetUrl(url);
        if (await overLimit(request, limiterFor(env, target))) {
            return tooManyRequests(origin);
        }
        if (request.method === 'OPTIONS') {
            return preflight(request, origin);
        }
        if (!READ_METHODS.includes(request.method)) {
            return new Response('Method not allowed', {
                status: 405,
                headers: {...corsHeaders(origin), Allow: ALLOWED_METHODS},
            });
        }
        if (!target) {
            return new Response('Not found', {status: 404, headers: corsHeaders(origin)});
        }
        if (hostMatches(new URL(target).hostname, OWN_HOSTS)) {
            return new Response('Forbidden target', {status: 403, headers: corsHeaders(origin)});
        }
        return proxy(request, env, ctx, origin, target, url.origin);
    },
};

export default worker;
