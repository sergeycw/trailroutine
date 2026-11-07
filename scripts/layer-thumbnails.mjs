// Превью подложек для столбца справа (change layer-thumbnails, design «Превью — картинки в сборке»; change
// three-quick-bases): по одному тайлу каждой из трёх подложек столбца (QUICK_BASES), половина тайла вокруг места →
// 72 px (круг 36 CSS px на экране 2x), WebP. Место и зум у каждой подложки свои (PLACES): над одним местом топокарта и
// обычная карта неотличимы, а без подписей превью должны различаться картинкой. Картинки лежат в
// web/src/layers/thumbnails/<код>.webp и попадают в сборку; приложение тайлов ради превью не запрашивает.
//
// Запуск из корня: PATH=/usr/local/bin:$PATH node --experimental-strip-types scripts/layer-thumbnails.mjs [код…]
// Без кодов — все три. Нужны Chromium Playwright из web/node_modules (npm ci в web/) и сеть.
// Страница — пустая заглушка на origin клона: провайдеры видят обычный Referer сайта.
//
// Круг топокарты — векторная OpenFreeMap Outdoor (design openfreemap-default-basemap): тайл — данные, а не картинка,
// вырезать нечего. Её рисует MapLibre из web/node_modules на той же заглушке (способ change add-vector-outdoor-style):
// стиль из outdoorLayers и источника каталога, холст 128×128 над местом из PLACES в масштабе половины растрового тайла
// этого зума (зум MapLibre на 1 меньше, AGENTS.md), снимок холста сжимается в те же 72 px. Подписи — английские (язык
// каталога скрипта).
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
// MapLibre 6 — только ESM: страница импортирует сборку и ставит адрес воркера, как src/map/maplibre.ts приложения
const MAPLIBRE_DIST = join(ROOT, 'web/node_modules/maplibre-gl/dist');

// Места превью по типу (design three-quick-bases, кандидаты сравнивались тройками на кругах 36 px): топокарта —
// склоны Гудаури (светлые луга, дорога, горизонтали: лес над Местиа на круге — тёмное пятно, как снимок; место
// выбиралось для Tracestrack Topo, OpenFreeMap Outdoor снимается там же), обычная карта — центр Тбилиси (кварталы,
// река, улицы), спутник — долина Местиа, как в первых превью
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
    // fx, fy — место точки внутри тайла (0…1): кадр берётся вокруг неё
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

// токены шаблона MapLibre, которые встречаются у подложек каталога
function tileUrl(template, tile) {
    return template
        .replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y))
        .replace('{quadkey}', quadkey(tile))
        .replace('{ratio}', '');
}

const only = new Set(process.argv.slice(2));
// код не из столбца раньше снимался молча (все подложки каталога), теперь его картинку некому показать
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
        // новая подложка в QUICK_BASES без места — понятная ошибка, а не падение всего скрипта на tileOf(undefined)
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
        // ошибка одной подложки (нет CORS, не картинка, сеть) не останавливает остальные
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
                    // половина тайла вокруг точки: на круге 36 px целый тайл превратился бы в пятно цвета
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
                    // без него холст после кадра пустой для drawImage
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

