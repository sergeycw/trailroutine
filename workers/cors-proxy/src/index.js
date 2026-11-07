import {anonymousTileUrl, heatmapCookie, isStravaHeatmap} from './strava';
import {errorBody, isTracestrackTile, responseHeaders, TRACESTRACK_HOST, withKey, withoutKey} from './tracestrack';

// user-agent: fetch из Worker'а своего не ставит, а часть сайтов без него отвечает 403 (так было у Wikimapia,
// чей адрес /wikimapia/ ушёл вместе со старым клиентом, change retire-old-client-services).
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'range', 'user-agent'];
const DROPPED_RESPONSE_HEADERS = ['set-cookie'];
const EXPOSED_HEADERS = 'Content-Disposition';
// Только чтение: клиент через прокси не шлёт POST, а пересылка тел делала прокси открытым релеем
// (security-аудит, п. 4; change restrict-cors-proxy).
const ALLOWED_METHODS = 'GET, HEAD, OPTIONS';
const READ_METHODS = ['GET', 'HEAD'];
// Хосты тайловых слоёв клона, которые приложение шлёт через прокси (viaCorsProxy в web/src/layers/catalog.ts):
// Strava heatmap, Tsvetkov и Tracestrack Topo. Они тратят RATE_LIMITER (1200 в минуту), все остальные хосты (импорт по ссылке,
// поиск, короткие ссылки, свои слои через прокси) — OTHER_RATE_LIMITER. Забытый здесь хост слоя не ломается, а
// получает меньший лимит.
const LAYER_HOSTS = [/^content-[a-z]\.strava\.com$/u, 'maptiles.website.yandexcloud.net', TRACESTRACK_HOST];
// Свои адреса клона: Worker'ы аккаунта и так отвечают на подзапрос error 1042, а Pages — нет.
const OWN_HOSTS = [/(^|\.)nakarte-routing\.workers\.dev$/u, /(^|\.)nakarte-routing\.pages\.dev$/u, /(^|\.)trailroutine\.com$/u];
// На эти ответы CloudFront на тайл с куками прокси пробует анонимный тайл: куки протухли или не приняты.
const STRAVA_REJECTED = [401, 403];
// Длина окна `[[ratelimits]]` в wrangler.toml.
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

// Счётчик по роли цели; без разобранной цели (404) — счётчик слоёв, как до разделения.
function limiterFor(env, target) {
    if (!target || hostMatches(new URL(target).hostname, LAYER_HOSTS)) {
        return env.RATE_LIMITER;
    }
    return env.OTHER_RATE_LIMITER;
}

// Без CF-Connecting-IP (локальный wrangler dev, тесты) частоту не ограничиваем.
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
    // без ключа тайл Tracestrack не запрашивается вовсе: клиент получает ошибку и откатывается на OSM
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
    // куки Strava уходят только на тайлы heatmap, cookie клиента не пересылается никогда (src/strava.js)
    const strava = isStravaHeatmap(target) ? await heatmapCookie(env, ctx) : null;
    if (strava?.cookie) {
        upstreamHeaders.set('cookie', strava.cookie);
    }
    // HEAD уходит к сервису как GET, как у авторского прокси на nginx (proxy_cache_convert_head):
    // короткие ссылки mapy.com на HEAD отвечают 404, а на GET — редиректом, который и нужен клиенту.
    const isHead = request.method === 'HEAD';
    function send(url) {
        return fetch(url, {method: 'GET', headers: upstreamHeaders, redirect: 'manual'});
    }
    // без кук или с отвергнутыми куками тайл z≤12 берётся с анонимного адреса Strava, без кук
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
    // откуда куки тайла (session, fallback, anonymous, none) — для проверки STRAVA_SESSION
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
