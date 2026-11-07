// Cookies for the tiles of Strava Global Heatmap (layers Sa/Sr/Sb/Sw). CloudFront gives the tiles
// content-*.strava.com/identified/globalheat/ only with the signed cookies CloudFront-Key-Pair-Id, CloudFront-Policy,
// CloudFront-Signature (without them 403 `MissingKey`) and the JWT cookie _strava_idcf (without it the CloudFront
// function answers 401). They live for approximately one day.
//
// The response of the HTML page www.strava.com/maps/global-heatmap to a logged-in user sets them (found 2026-10-08 in
// the browser of the owner: the getKey and notifications requests do not set them). Thus the proxy keeps the secret
// STRAVA_SESSION (the Strava session cookies in the form of a Cookie header) and itself requests this page when the
// cookies expire. The fallback is the static secret STRAVA_COOKIES (scripts/strava-heatmap-secret.mjs). Decisions:
// openspec/changes/archive/*-add-strava-heatmap-refresh/design.md.
//
// The session, the cookies and the Set-Cookie lines never go to the log: only names and statuses. fetchHeatmapCookies
// does not depend on the env of the Worker: scripts/strava-session-secret.mjs imports it under Node.

const HEATMAP_COOKIES = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature', '_strava_idcf'];
const HEATMAP_TILE = {host: /^content-[a-z]\.strava\.com$/u, path: /^\/identified\/globalheat\//u};
const HEATMAP_PAGE = 'https://www.strava.com/maps/global-heatmap';
// the session goes only here: a redirect to a different origin is a failure, and the proxy does not follow it
const STRAVA_ORIGIN = 'https://www.strava.com';
// Strava answers a rejected session with a redirect to this path
const LOGIN_PATH = /^\/(login|session)\b/u;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;
// Strava gives the page to a browser; the empty User-Agent of fetch in a Worker can get a refusal, as with Wikimapia
const USER_AGENT = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
].join(' ');

// The cookies refresh 30 minutes before the policy expiry: this covers clock skew and tiles started before the expiry.
const EXPIRY_MARGIN_MS = 30 * 60 * 1000;
// The policy did not parse: an extra refresh after one hour is better than cookies of unknown freshness.
const UNKNOWN_EXPIRY_TTL_MS = 60 * 60 * 1000;
// After a failure (the session is rejected, Strava gave an unexpected answer), do not request the page for each tile.
const RETRY_PAUSE_MS = 10 * 60 * 1000;

// Anonymous heatmap: without login, Strava gives the same tiles from heatmap-external-{a,b,c}.strava.com/tiles/
// up to z12 with px=256 and up to z11 with px=512, above that 403 (measured 2026-10-08; canicule does the same). The
// proxy gets them when there are no cookies or CloudFront did not accept them: the layers are not empty at overview
// zooms without a session.
const ANONYMOUS_MAX_ZOOM = {256: 12, 512: 11};
const ANONYMOUS_HOSTS = ['a', 'b', 'c'];
const HEATMAP_TILE_PATH = /^\/identified\/globalheat\/(\w+)\/(\w+)\/(\d+)\/(\d+)\/(\d+)\.png$/u;

// The address of the same tile without login, or null if the zoom is above the limit. Without px, Strava gives 256.
function anonymousTileUrl(target) {
    const url = new URL(target);
    const match = HEATMAP_TILE_PATH.exec(url.pathname);
    if (!match) {
        return null;
    }
    const [, activity, color, z, x, y] = match;
    const px = url.searchParams.get('px') ?? '256';
    const maxZoom = ANONYMOUS_MAX_ZOOM[px];
    if (maxZoom === undefined || Number(z) > maxZoom) {
        return null;
    }
    // the subdomain depends on the tile, as subdomains in Leaflet: one tile always has one host
    const host = ANONYMOUS_HOSTS[(Number(x) + Number(y)) % ANONYMOUS_HOSTS.length];
    return `https://heatmap-external-${host}.strava.com/tiles/${activity}/${color}/${z}/${x}/${y}.png?px=${px}`;
}

function isStravaHeatmap(target) {
    const url = new URL(target);
    return HEATMAP_TILE.host.test(url.hostname) && HEATMAP_TILE.path.test(url.pathname);
}

// CloudFront-Policy is the policy JSON in base64 with the CloudFront replacements: + → -, = → _, / → ~.
// The expiry is Condition.DateLessThan['AWS:EpochTime'] of the first Statement, in seconds. Returns milliseconds.
function policyExpiry(policy) {
    try {
        const json = atob(policy.replace(/-/gu, '+').replace(/_/gu, '=').replace(/~/gu, '/'));
        const epoch = JSON.parse(json).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
        return Number.isFinite(epoch) ? epoch * 1000 : null;
    } catch {
        return null;
    }
}

// The cookie name and its lifetime from the Expires/Max-Age attributes, without the value: this log shows if
// Strava extends the session (_strava4_session in the response) and by how much.
function describeSetCookie(line) {
    const [pair, ...attributes] = line.split(';');
    const name = pair.slice(0, pair.indexOf('=')).trim();
    const lifetime = attributes
        .map((attribute) => attribute.trim())
        .filter((attribute) => /^(expires|max-age)=/iu.test(attribute));
    return lifetime.length ? `${name} (${lifetime.join(', ')})` : name;
}

function collectHeatmapCookies(response, found, seen) {
    for (const line of response.headers.getSetCookie()) {
        seen.push(describeSetCookie(line));
        const pair = line.split(';', 1)[0];
        const eq = pair.indexOf('=');
        const name = pair.slice(0, eq).trim();
        if (eq > 0 && HEATMAP_COOKIES.includes(name)) {
            found.set(name, pair.slice(eq + 1).trim());
        }
    }
}

// An error with the description of all Set-Cookie lines of the chain (names and lifetimes), so the log shows them
// also on a failure.
function refreshError(message, seen) {
    return Object.assign(new Error(message), {setCookies: seen});
}

// The errors contain only the status, the path and the cookie names: their text goes to the log and to the script
// output. setCookies contains the names and lifetimes of all cookies from the responses, without the values.
async function fetchHeatmapCookies(session, fetchImpl = fetch) {
    const found = new Map();
    const seen = [];
    let url = HEATMAP_PAGE;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetchImpl(url, {
            headers: {'cookie': session, 'accept': 'text/html', 'user-agent': USER_AGENT},
            redirect: 'manual',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // only the headers are necessary: do not read the HTML and do not use CPU on it
        await response.body?.cancel();
        collectHeatmapCookies(response, found, seen);
        const location = response.headers.get('location');
        if (response.status >= 300 && response.status < 400 && location) {
            const next = new URL(location, url);
            if (next.origin !== STRAVA_ORIGIN) {
                throw refreshError(
                    `strava page redirects off ${STRAVA_ORIGIN}: ${response.status} to ${next.host}`,
                    seen
                );
            }
            if (LOGIN_PATH.test(next.pathname)) {
                throw refreshError(`strava session rejected: ${response.status} to ${next.pathname}`, seen);
            }
            url = next.href;
            continue;
        }
        if (!response.ok) {
            throw refreshError(`strava page answered ${response.status}`, seen);
        }
        // Strava answered a fake session like this on 2026-10-08: 200 without cookies, not a redirect to /login
        if (!found.size) {
            throw refreshError(`strava page set no heatmap cookies: ${response.status}, session not logged in`, seen);
        }
        const missing = HEATMAP_COOKIES.filter((name) => !found.has(name));
        if (missing.length) {
            throw refreshError(`strava page set no ${missing.join(', ')}`, seen);
        }
        return {
            cookie: HEATMAP_COOKIES.map((name) => `${name}=${found.get(name)}`).join('; '),
            expiresAt: policyExpiry(found.get('CloudFront-Policy')),
            setCookies: seen,
        };
    }
    throw refreshError(`strava page redirects more than ${MAX_REDIRECTS} times`, seen);
}

// The state of the isolate. The refresh promise resolves to a string, not to a Response, thus parallel requests
// can wait for it (requests cannot share I/O objects). A change of STRAVA_SESSION resets all of it.
const state = {session: null, cookie: null, freshUntil: 0, expiresAt: 0, failedAt: -Infinity, refreshing: null};

function resetState(session) {
    Object.assign(state, {session, cookie: null, freshUntil: 0, expiresAt: 0, failedAt: -Infinity, refreshing: null});
}

// The best available cookies while there are no fresh ones: the old ones if CloudFront still accepts them,
// otherwise the fallback secret.
function bestKnown(now, fallback) {
    return state.cookie && now < state.expiresAt ? {cookie: state.cookie, source: 'session'} : fallback;
}

async function refresh(session, now) {
    try {
        const {cookie, expiresAt, setCookies} = await fetchHeatmapCookies(session);
        console.log(`strava page set-cookie: ${setCookies.join('; ')}`);
        if (state.session !== session) {
            return null;
        }
        if (expiresAt === null) {
            Object.assign(state, {
                cookie,
                expiresAt: now + UNKNOWN_EXPIRY_TTL_MS,
                freshUntil: now + UNKNOWN_EXPIRY_TTL_MS,
            });
            return cookie;
        }
        // if the policy is shorter than the margin, refresh still not more often than once per pause
        Object.assign(state, {
            cookie,
            expiresAt,
            freshUntil: Math.max(expiresAt - EXPIRY_MARGIN_MS, now + RETRY_PAUSE_MS),
        });
        return cookie;
    } catch (error) {
        console.error(`strava heatmap cookies not refreshed: ${error.message}`);
        if (error.setCookies?.length) {
            console.error(`strava page set-cookie: ${error.setCookies.join('; ')}`);
        }
        if (state.session === session) {
            state.failedAt = now;
        }
        return null;
    } finally {
        if (state.session === session) {
            state.refreshing = null;
        }
    }
}

// Cookies for a heatmap tile: {cookie, source}, source is session, fallback or none (no cookies).
// `ctx` is the request context of the Worker: the refresh goes into waitUntil, so a client disconnect
// does not cancel the fetch that parallel requests wait for.
async function heatmapCookie(env, ctx, now = Date.now()) {
    const fallback = env.STRAVA_COOKIES
        ? {cookie: env.STRAVA_COOKIES, source: 'fallback'}
        : {cookie: null, source: 'none'};
    const session = env.STRAVA_SESSION;
    if (!session) {
        return fallback;
    }
    if (state.session !== session) {
        resetState(session);
    }
    if (state.cookie && now < state.freshUntil) {
        return {cookie: state.cookie, source: 'session'};
    }
    if (now - state.failedAt < RETRY_PAUSE_MS) {
        return bestKnown(now, fallback);
    }
    if (!state.refreshing) {
        state.refreshing = refresh(session, now);
        ctx?.waitUntil(state.refreshing);
    }
    const cookie = await state.refreshing;
    return cookie ? {cookie, source: 'session'} : bestKnown(now, fallback);
}

export {
    HEATMAP_COOKIES,
    RETRY_PAUSE_MS,
    anonymousTileUrl,
    describeSetCookie,
    fetchHeatmapCookies,
    heatmapCookie,
    isStravaHeatmap,
    policyExpiry,
};
