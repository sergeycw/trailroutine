import {trackKey} from './key';

// A link is a simplified track in nktk, 3–4 bytes per point: 2 MiB is hundreds of thousands of points. It was 10 MiB,
// and from one IP this gave ≈ 27 TB of storage per month of attack (security audit, item 3; change limit-track-writes).
const MAX_TRACK_BYTES = 2 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/u;
// The link body is nktk strings in the base64url of the client (it does not remove the `=` padding), joined with `/`.
const LINK_BODY = /^[A-Za-z0-9_\-=/]*$/u;
const ALLOWED_METHODS = 'GET, POST, OPTIONS';
// The window length of `[[ratelimits]]` in wrangler.toml.
const RETRY_AFTER_SECONDS = '60';

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Vary': 'Origin',
    };
}

function respond(origin, status, body = null, headers = {}) {
    return new Response(body, {status, headers: {...corsHeaders(origin), ...headers}});
}

// Without CF-Connecting-IP (local wrangler dev, tests) the rate is not limited. limiter is a binding of
// [[ratelimits]]: RATE_LIMITER for all requests, WRITE_RATE_LIMITER also for POST.
async function overLimit(request, limiter) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) {
        return false;
    }
    const {success} = await limiter.limit({key: ip});
    return !success;
}

function tooManyRequests(origin) {
    return respond(origin, 429, 'Too many requests\n', {'Retry-After': RETRY_AFTER_SECONDS});
}

function preflight(request, origin) {
    const headers = {'Access-Control-Allow-Methods': ALLOWED_METHODS};
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    if (requestedHeaders) {
        headers['Access-Control-Allow-Headers'] = requestedHeaders;
    }
    return respond(origin, 204, null, headers);
}

async function readLimited(request, limit) {
    const declaredLength = Number(request.headers.get('Content-Length'));
    if (declaredLength > limit) {
        return null;
    }
    if (!request.body) {
        return new Uint8Array();
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of request.body) {
        total += chunk.byteLength;
        if (total > limit) {
            return null;
        }
        chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

// The nktk versions of the link body, as a sorted list «4» or «3,4» for customMetadata.nktk: a migration of the format
// finds the old objects by a listing, without reading the bodies (spec track-storage, «Время записи»). The version is
// the first packed number of each string: its first byte minus 64 (web/src/tracks/nktk.ts, PackedReader); the
// versions 0–4 fit one byte. An unreadable string is skipped.
export function nktkVersions(text) {
    const versions = new Set();
    for (const item of text.split('/')) {
        try {
            const head = atob(item.slice(0, 4).replace(/-/gu, '+').replace(/_/gu, '/'));
            const first = head.charCodeAt(0);
            if (first < 128) {
                versions.add(first - 64);
            }
        } catch {
            // not base64: no version
        }
    }
    return [...versions].sort((a, b) => a - b).join(',');
}

function trackMetadata(text, extra = {}) {
    return {created: new Date().toISOString(), nktk: nktkVersions(text), ...extra};
}

async function saveTrack(request, env, origin, key) {
    const bytes = await readLimited(request, MAX_TRACK_BYTES);
    if (!bytes) {
        return respond(origin, 413, 'Track is too big');
    }
    const text = new TextDecoder().decode(bytes);
    if (!LINK_BODY.test(text)) {
        return respond(origin, 400, 'Not a track link');
    }
    if (trackKey(text) !== key) {
        return respond(origin, 400, 'Key does not match track');
    }
    const objectKey = `tracks/${key}`;
    if (!(await env.TRACKS.head(objectKey))) {
        // the write time: after an abuse, a listing finds the objects of a time window without reading the bodies
        await env.TRACKS.put(objectKey, bytes, {customMetadata: trackMetadata(text)});
    }
    return respond(origin, 200);
}

// nktl= links of nakarte.me keep their tracks in the author's storage. Its key is the same base64url md5 of the body
// as ours (checked on a real key on 2026-11-07), so one key means one body, and the Worker can keep a copy
// (change import-nakarte-storage-links, spec track-storage, «Track from the storage of nakarte.me»).
const NAKARTE_TRACKS = 'https://tracks.nakarte.me/track/';
const NAKARTE_TIMEOUT_MS = 5000;

// The body of the author's track if the author has it and it passes the checks of POST, null on the author's 404,
// undefined on any other failure. The checks stop a broken or foreign answer from landing under the key.
async function fromNakarte(key) {
    let response;
    try {
        response = await fetch(`${NAKARTE_TRACKS}${key}`, {signal: AbortSignal.timeout(NAKARTE_TIMEOUT_MS)});
    } catch {
        return undefined;
    }
    if (response.status === 404) {
        return null;
    }
    if (!response.ok) {
        return undefined;
    }
    const bytes = await readLimited(response, MAX_TRACK_BYTES);
    if (!bytes) {
        return undefined;
    }
    const text = new TextDecoder().decode(bytes);
    if (!LINK_BODY.test(text) || trackKey(text) !== key) {
        return undefined;
    }
    return bytes;
}

const TRACK_HEADERS = {
    'Content-Type': 'text/plain',
    'Cache-Control': 'public, max-age=31536000, immutable',
};

async function loadTrack(env, origin, key) {
    const objectKey = `tracks/${key}`;
    const object = await env.TRACKS.get(objectKey);
    if (object) {
        return respond(origin, 200, object.body, TRACK_HEADERS);
    }
    const copied = await fromNakarte(key);
    if (copied === null) {
        return respond(origin, 404, 'Track not found');
    }
    if (!copied) {
        return respond(origin, 502, 'Track storage of nakarte.me is not available');
    }
    await env.TRACKS.put(objectKey, copied, {
        customMetadata: trackMetadata(new TextDecoder().decode(copied), {source: 'nakarte.me'}),
    });
    return respond(origin, 200, copied, TRACK_HEADERS);
}

const worker = {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        if (!origin || !allowedOrigins(env).includes(origin)) {
            return new Response('Origin not allowed', {status: 403});
        }
        if (await overLimit(request, env.RATE_LIMITER)) {
            return tooManyRequests(origin);
        }
        if (request.method === 'OPTIONS') {
            return preflight(request, origin);
        }
        const match = new URL(request.url).pathname.match(/^\/track\/([^/]+)$/u);
        if (!match) {
            return respond(origin, 404, 'Not found');
        }
        const key = match[1];
        if (!KEY_PATTERN.test(key)) {
            return respond(origin, 400, 'Malformed key');
        }
        if (request.method === 'POST') {
            if (await overLimit(request, env.WRITE_RATE_LIMITER)) {
                return tooManyRequests(origin);
            }
            return saveTrack(request, env, origin, key);
        }
        if (request.method === 'GET') {
            return loadTrack(env, origin, key);
        }
        return respond(origin, 405, 'Method not allowed', {Allow: ALLOWED_METHODS});
    },
};

export default worker;
