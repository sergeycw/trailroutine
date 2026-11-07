// Tiles of Tracestrack Topo, the second basemap of the fallback chain Of → Tt → OSM (layer Tt in
// web/src/layers/catalog.ts). The API key is the Worker secret TRACESTRACK_KEY: it is not in the bundle and not in the
// client address (design add-outdoor-basemap).

export const TRACESTRACK_HOST = 'tile.tracestrack.com';

// The key is used only for the raster that the app shows: topo_<language> has labels in the browser language or in
// English (tracestrackMap in web/src/layers/catalog.ts has the same language list: a change in one list is a change in
// both), topo__ has no translation, tabs opened before design tracestrack-labels request it; @2x is a high-density tile
// for the same credit. Vector tiles and the elevation API of Tracestrack cost 6 credits each, and other people could
// request them through the proxy with a fake Origin, so such addresses go without the key.
const LANGUAGES = [
    '_',
    'ar',
    'de',
    'en',
    'es',
    'fi',
    'fr',
    'hu',
    'he',
    'it',
    'ja',
    'ko',
    'nl',
    'uk',
    'pl',
    'pt',
    'ru',
    'th',
    'sv',
    'tr',
    'zh-hans',
    'zh-hant',
];
const TILE_PATH = new RegExp(`^/topo_(${LANGUAGES.join('|')})/\\d+/\\d+/\\d+(@2x)?\\.webp$`, 'u');

// Without Cache-Control in the response, the browser would request the tiles again on each visit, and each successful
// tile is a credit of the free quota (100 thousand per month). Keep the own header of Tracestrack if it exists.
const DEFAULT_CACHE_CONTROL = 'public, max-age=86400';

// Only https on the standard port: /http/… or a different port with a fake Origin would send the key as plain text or
// to a wrong place
export function isTracestrackTile(target) {
    const url = new URL(target);
    return (
        url.protocol === 'https:' && url.port === '' && url.hostname === TRACESTRACK_HOST && TILE_PATH.test(url.pathname)
    );
}

// The proxy drops all of the client query after the path: it can contain a foreign key, and the tile needs no other
// parameters
export function withKey(target, key) {
    const url = new URL(target);
    url.search = '';
    url.searchParams.set('key', key);
    return url.href;
}

// The headers of a tile response go through an allowlist: without the key it is not possible to check what Tracestrack
// puts into the other headers (Link, Content-Location, debug headers), and the key in them would go to the client. The
// proxy sets Location itself (withoutKey)
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'expires'];

export function responseHeaders(upstream) {
    const headers = new Headers();
    for (const name of RESPONSE_HEADERS) {
        const value = upstream.headers.get(name);
        if (value) {
            headers.set(name, value);
        }
    }
    if (upstream.status === 200 && !headers.has('cache-control')) {
        headers.set('cache-control', DEFAULT_CACHE_CONTROL);
    }
    return headers;
}

// The error body of Tracestrack does not go to the client: a text like «key … exceeded quota» could repeat the key. The
// status is sufficient for the client: it falls back to OSM by the status
export function errorBody(status) {
    return `Tracestrack error ${status}\n`;
}

// The Location of a tile response goes to the client through the proxy, without the key
export function withoutKey(absoluteUrl) {
    const url = new URL(absoluteUrl);
    url.searchParams.delete('key');
    return url.href;
}
