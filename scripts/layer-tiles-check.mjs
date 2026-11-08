// Weekly check of the map layers (Things to-do «Add a weekly check of one tile per map layer»): tile providers stop
// working one at a time, and then the layer in the app only becomes empty, without an error for Sentry. The script
// takes the layers of the app catalog (web/src/layers/catalog.ts) and requests one tile of each raster layer, as the
// app does: with the Origin of the site, through the proxy for the proxy layers.
//
// A layer passes when its tile answers 200 with an image and an Access-Control-Allow-Origin header: MapLibre draws
// tiles with WebGL, and WebGL needs CORS on each answer. A redirect fails too: providers answer a moved address with a
// redirect without CORS (AGENTS.md, «Провайдеры тайлов меняют адреса»), so the catalog keeps the final addresses.
//
// Run from the root: PATH=/usr/local/bin:$PATH node --experimental-strip-types scripts/layer-tiles-check.mjs [code…]
// Without codes, all layers that the check covers. Node 24 of the workflow layer-tiles-check.yml strips the types
// without the flag. The exit code is 1 when a layer fails after a retry.
import {buildCatalog} from '../web/src/layers/catalog.ts';

// the same addresses as CORS_PROXY_URL in web/src/config.ts and the site of the move (siteOrigin)
const CORS_PROXY_URL = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev/';
const ORIGIN = 'https://trailroutine.com';

// Layers that other checks or nothing cover:
// - Of: vector, the daily workflow openfreemap check reads its TileJSON and a tile;
// - Tt: the daily workflow tracestrack check (each tile is a credit of the free quota);
// - Sa, Sr, Sb, Sw: Strava heatmap, the daily workflow strava heatmap check (the session of the proxy);
// - Hls: dated imagery, the tile address needs a date of the Earth Search catalog;
// - Ct: the contour lines are built in the browser from the tiles of Hs, which the check covers.
const SKIP = new Set(['Of', 'Tt', 'Sa', 'Sr', 'Sb', 'Sw', 'Hls', 'Ct']);

// The tile place: the center of the layer bounds, else Kazbegi (the Caucasus, where the global layers have data).
// Regional layers without bounds in the catalog have their place here.
const DEFAULT_PLACE = {lat: 42.66, lng: 44.64};
const PLACES = {
    // the mountain maps of Aleksey Tsvetkov cover only the ranges, not all of the bounds: Khan Tengri has z9–z13
    Mt: {lat: 42.21, lng: 80.17},
};
const ZOOM = 12;

function tileOf(lat, lng, zoom) {
    const n = 2 ** zoom;
    const x = Math.floor(((lng + 180) / 360) * n);
    const rad = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
    return {x, y, z: zoom};
}

// the quadkey of Bing (the placeholder {quadkey} of MapLibre)
function quadkey({x, y, z}) {
    let key = '';
    for (let i = z; i > 0; i--) {
        const mask = 1 << (i - 1);
        key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
    }
    return key;
}

function tileUrl(layer) {
    const [west, south, east, north] = layer.source.bounds ?? [];
    const place =
        PLACES[layer.code] ?? (layer.source.bounds ? {lat: (south + north) / 2, lng: (west + east) / 2} : DEFAULT_PLACE);
    const maxZoom = layer.source.maxzoom ?? ZOOM;
    const zoom = Math.max(Math.min(ZOOM, maxZoom), layer.source.minzoom ?? 0);
    const tile = tileOf(place.lat, place.lng, zoom);
    return layer.source.tiles[0]
        .replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y))
        .replace('{ratio}', '')
        .replace('{quadkey}', quadkey(tile));
}

async function check(url) {
    try {
        const response = await fetch(url, {
            headers: {Origin: ORIGIN, Referer: `${ORIGIN}/`},
            redirect: 'manual',
            signal: AbortSignal.timeout(30_000),
        });
        const type = response.headers.get('content-type') ?? '';
        const cors = response.headers.get('access-control-allow-origin') ?? '';
        const size = (await response.arrayBuffer()).byteLength;
        const problems = [];
        if (response.status !== 200) {
            const location = response.headers.get('location');
            problems.push(`status ${response.status}${location ? ` → ${location}` : ''}`);
        }
        if (!type.startsWith('image/')) {
            problems.push(`content-type '${type}'`);
        }
        if (cors !== '*' && cors !== ORIGIN) {
            problems.push(`access-control-allow-origin '${cors}'`);
        }
        if (size === 0) {
            problems.push('empty body');
        }
        return problems;
    } catch (error) {
        return [String(error.cause ?? error.message ?? error)];
    }
}

const only = new Set(process.argv.slice(2));
const layers = buildCatalog({pixelRatio: 1, language: 'en', corsProxyUrl: CORS_PROXY_URL}).filter(
    (layer) =>
        layer.source.tiles && (only.size ? only.has(layer.code) : !SKIP.has(layer.code) && !layer.dated),
);

const results = await Promise.all(
    layers.map(async (layer) => {
        const url = tileUrl(layer);
        let problems = await check(url);
        if (problems.length) {
            // one retry: a single failed request is not a broken layer
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            problems = await check(url);
        }
        return {layer, url, problems};
    }),
);

let failed = 0;
for (const {layer, url, problems} of results) {
    if (problems.length) {
        failed++;
        // the GitHub annotation format: the run summary lists each broken layer
        console.log(`::error::${layer.code} (${layer.title}): ${problems.join(', ')} — ${url}`);
    } else {
        console.log(`ok ${layer.code} (${layer.title})`);
    }
}
console.log(`${results.length - failed} of ${results.length} layers answer with a tile`);
process.exitCode = failed ? 1 : 0;
