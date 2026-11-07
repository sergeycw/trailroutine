// Basemap thumbnails for the column on the right (change layer-thumbnails, design «Превью — картинки в сборке»; change
// three-quick-bases): one tile of each of the three basemaps of the column (QUICK_BASES), half a tile around the
// place → 72 px (a circle of 36 CSS px on a 2x screen), WebP. Each basemap has its own place and zoom (PLACES): over
// one place the topo map and the regular map look the same, and without labels the thumbnails must differ by the
// image. The images are in web/src/layers/thumbnails/<code>.webp and go into the build; the app does not request tiles
// for them.
//
// Run from the root: PATH=/usr/local/bin:$PATH node --experimental-strip-types scripts/layer-thumbnails.mjs [code…]
// Without codes, all three. It needs the Playwright Chromium from web/node_modules (npm ci in web/) and the network.
// The page is an empty stub on the origin of the clone: the providers see the usual Referer of the site.
//
// The topo map circle is the vector OpenFreeMap Outdoor (design openfreemap-default-basemap): the tile is data, not an
// image, there is nothing to cut. MapLibre from web/node_modules draws it on the same stub (the method of change
// add-vector-outdoor-style): the style from outdoorLayers and the catalog source, a 128×128 canvas over the place from
// PLACES at the scale of half a raster tile of this zoom (the MapLibre zoom is 1 less, AGENTS.md), the canvas snapshot
// is scaled down to the same 72 px. The labels are in English (the catalog language of the script).
import {createRequire} from 'node:module';
import {writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCatalog} from '../web/src/layers/catalog.ts';
import {outdoorLayers} from '../web/src/layers/outdoor.ts';
import {QUICK_BASES} from '../web/src/layers/quick-layers.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'web/src/layers/thumbnails');
const require = createRequire(join(ROOT, 'web/package.json'));
const {chromium} = require('playwright');
// MapLibre 6 is ESM only: the page imports the build and sets the worker URL, as src/map/maplibre.ts of the app does
const MAPLIBRE_DIST = join(ROOT, 'web/node_modules/maplibre-gl/dist');

// Thumbnail places by type (design three-quick-bases, the candidates were compared in sets of three on 36 px circles):
// topo map — the slopes of Gudauri (light meadows, a road, contour lines: the forest above Mestia gives a dark spot on
// the circle, similar to the satellite image; the place was selected for Tracestrack Topo, OpenFreeMap Outdoor is
// captured at the same place), regular map — the center of Tbilisi (blocks, a river, streets), satellite — the Mestia
// valley, as in the first thumbnails
const PLACES = {
    Of: {lat: 42.47, lng: 44.48, zoom: 13},
    G: {lat: 41.705, lng: 44.795, zoom: 14},
    E: {lat: 43.0467, lng: 42.7286, zoom: 12},
};
const ORIGIN = 'https://trailroutine.com';
const CORS_PROXY_URL = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev/';

function tileOf({lat, lng, zoom}) {
    const n = 2 ** zoom;
    const rad = (lat * Math.PI) / 180;
    const x = ((lng + 180) / 360) * n;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
    // fx, fy: the position of the point in the tile (0…1): the frame is taken around it
    return {x: Math.floor(x), y: Math.floor(y), z: zoom, fx: x % 1, fy: y % 1};
}

function quadkey({x, y, z}) {
    let key = '';
    for (let i = z; i > 0; i--) {
        const mask = 1 << (i - 1);
        key += ((x & mask ? 1 : 0) + (y & mask ? 2 : 0)).toString();
    }
    return key;
}

// the MapLibre template tokens that the basemaps of the catalog use
function tileUrl(template, tile) {
    return template
        .replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y))
        .replace('{quadkey}', quadkey(tile))
        .replace('{ratio}', '');
}

const only = new Set(process.argv.slice(2));
// before, the script captured a code outside the column silently (all catalog basemaps), now nothing shows its image
const unknown = [...only].filter((code) => !QUICK_BASES.includes(code));
if (unknown.length > 0) {
    console.error(`not in QUICK_BASES (web/src/layers/quick-layers.ts): ${unknown.join(' ')}`);
    process.exit(1);
}
const bases = buildCatalog({pixelRatio: 1, language: 'en', corsProxyUrl: CORS_PROXY_URL}).filter(
    (layer) => QUICK_BASES.includes(layer.code) && (only.size === 0 || only.has(layer.code)),
);

const browser = await chromium.launch();
let failed = 0;
try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/__thumbnails`, (route) =>
        route.fulfill({contentType: 'text/html', body: '<!doctype html>'}),
    );
    await page.route(`${ORIGIN}/__maplibre/*`, (route) =>
        route.fulfill({
            path: join(MAPLIBRE_DIST, new URL(route.request().url()).pathname.split('/').pop()),
            contentType: 'text/javascript',
        }),
    );
    await page.goto(`${ORIGIN}/__thumbnails`);
    for (const layer of bases) {
        // a new basemap in QUICK_BASES without a place gives a clear error, not a script failure on tileOf(undefined)
        if (!PLACES[layer.code]) {
            failed++;
            console.error(`${layer.code} ${layer.title}: no place in PLACES`);
            continue;
        }
        if (layer.source.type === 'vector') {
            const result = await vectorThumbnail(page, layer, PLACES[layer.code]);
            if (result.error) {
                failed++;
                console.error(`${layer.code} ${layer.title}: ${result.error}`);
                continue;
            }
            await writeFile(join(OUT_DIR, `${layer.code}.webp`), Uint8Array.from(result.bytes));
            console.log(`${layer.code} ${layer.title}: ${result.bytes.length} bytes`);
            continue;
        }
        const tile = tileOf(PLACES[layer.code]);
        const url = tileUrl(layer.source.tiles[0], tile);
        // an error of one basemap (no CORS, not an image, network) does not stop the others
        const result = await page.evaluate(
            async ({src, fx, fy}) => {
                try {
                    const response = await fetch(src, {mode: 'cors'});
                    if (!response.ok) {
                        return {error: `HTTP ${response.status}`};
                    }
                    const bitmap = await createImageBitmap(await response.blob());
                    const canvas = new OffscreenCanvas(72, 72);
                    const context = canvas.getContext('2d');
                    // half a tile around the point: on a 36 px circle a full tile would become a spot of color
                    const size = bitmap.width / 2;
                    const left = Math.min(Math.max(fx * bitmap.width - size / 2, 0), bitmap.width - size);
                    const top = Math.min(Math.max(fy * bitmap.height - size / 2, 0), bitmap.height - size);
                    context.drawImage(bitmap, left, top, size, size, 0, 0, 72, 72);
                    const blob = await canvas.convertToBlob({type: 'image/webp', quality: 0.8});
                    return {bytes: [...new Uint8Array(await blob.arrayBuffer())]};
                } catch (error) {
                    return {error: String(error)};
                }
            },
            {src: url, fx: tile.fx, fy: tile.fy},
        );
        if (result.error) {
            failed++;
            console.error(`${layer.code} ${layer.title}: ${result.error} ${url}`);
            continue;
        }
        await writeFile(join(OUT_DIR, `${layer.code}.webp`), Uint8Array.from(result.bytes));
        console.log(`${layer.code} ${layer.title}: ${result.bytes.length} bytes`);
    }
} finally {
    await browser.close();
}
process.exitCode = failed ? 1 : 0;

async function vectorThumbnail(page, layer, place) {
    const style = {
        version: 8,
        sources: {[layer.code]: layer.source},
        layers: outdoorLayers(layer.code, layer.labelLanguage ?? 'en'),
    };
    return page.evaluate(
        async ({style, center}) => {
            try {
                const maplibre = await import('/__maplibre/maplibre-gl.mjs');
                maplibre.setWorkerUrl('/__maplibre/maplibre-gl-worker.mjs');
                const container = document.createElement('div');
                container.style.cssText = 'width: 128px; height: 128px';
                document.body.append(container);
                const map = new maplibre.Map({
                    container,
                    style,
                    center: [center.lng, center.lat],
                    zoom: center.zoom - 1,
                    interactive: false,
                    attributionControl: false,
                    pixelRatio: 1,
                    // without it the canvas is empty for drawImage after the frame
                    canvasContextAttributes: {preserveDrawingBuffer: true},
                });
                await new Promise((resolve, reject) => {
                    map.once('idle', resolve);
                    map.once('error', (event) => reject(event.error));
                });
                const canvas = new OffscreenCanvas(72, 72);
                canvas.getContext('2d').drawImage(map.getCanvas(), 0, 0, 72, 72);
                const blob = await canvas.convertToBlob({type: 'image/webp', quality: 0.8});
                map.remove();
                container.remove();
                return {bytes: [...new Uint8Array(await blob.arrayBuffer())]};
            } catch (error) {
                return {error: String(error)};
            }
        },
        {style, center: place},
    );
}

