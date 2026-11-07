const PATH_PREFIX = '/tiles/';
const EMPTY_FILES = ['storageconfig.txt'];
// Only tiles go outside; the Worker does not give the sync file manifest.json and the other bucket keys.
const TILE_KEY = /^[EW]\d{1,3}_[NS]\d{1,2}\.rd5$/u;
// The sync overwrites a tile under the same key, and the engine reads it in parts by Range.
// With the browser cache (it was max-age=86400) Chrome joins a response from old cached bytes and new bytes
// from the network, and BRouter gets the index of one tile version and the data of another. Thus no cache.
const CACHE_CONTROL = 'no-store';

function objectHeaders(object) {
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Cache-Control', CACHE_CONTROL);
    if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/octet-stream');
    }
    return headers;
}

function resolvedRange(object) {
    const {range, size} = object;
    if ('suffix' in range) {
        return {offset: size - range.suffix, length: range.suffix};
    }
    const offset = range.offset ?? 0;
    return {offset, length: range.length ?? size - offset};
}

function startsPastEnd(rangeHeader, size) {
    const match = /^bytes=(\d+)-/u.exec(rangeHeader ?? '');
    return Boolean(match) && Number(match[1]) >= size;
}

async function head(env, key) {
    const object = await env.TILES.head(key);
    if (!object) {
        return new Response(null, {status: 404});
    }
    const headers = objectHeaders(object);
    headers.set('Content-Length', String(object.size));
    return new Response(null, {headers});
}

async function get(request, env, key) {
    const hasRange = request.headers.has('Range');
    let object;
    try {
        object = await env.TILES.get(key, {range: request.headers});
    } catch {
        return new Response(null, {status: 416});
    }
    if (!object) {
        return new Response('Not found', {status: 404});
    }
    // R2 in Cloudflare throws an exception for a range past the end of the object (above → 416), but the local R2
    // of miniflare gives the object; the code checks it, so wrangler dev and the tests behave as production.
    if (hasRange && startsPastEnd(request.headers.get('Range'), object.size)) {
        await object.body.cancel();
        return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${object.size}`}});
    }
    const headers = objectHeaders(object);
    if (!hasRange || !object.range) {
        headers.set('Content-Length', String(object.size));
        return new Response(object.body, {headers});
    }
    const {offset, length} = resolvedRange(object);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, {status: 206, headers});
}

const worker = {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(PATH_PREFIX)) {
            return new Response('Not found', {status: 404});
        }
        if (!['GET', 'HEAD'].includes(request.method)) {
            return new Response('Method not allowed', {status: 405});
        }
        const key = decodeURIComponent(url.pathname.slice(PATH_PREFIX.length));
        if (EMPTY_FILES.includes(key)) {
            return new Response('', {headers: {'Content-Length': '0'}});
        }
        if (!TILE_KEY.test(key)) {
            return new Response('Not found', {status: 404});
        }
        if (request.method === 'HEAD') {
            return head(env, key);
        }
        return get(request, env, key);
    },
};

export default worker;
