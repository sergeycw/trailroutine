import { fileURLToPath } from 'node:url';
import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { makeConfig } from '../src/config.ts';
import { buildCatalog, OPENFREEMAP_TILEJSON } from '../src/layers/catalog.ts';
import { COVERAGE_CODE, COVERAGE_TILES } from '../src/streetview/coverage.ts';

const TILE_FIXTURE = fileURLToPath(new URL('../src/test/tile.png', import.meta.url));
// векторная подложка по умолчанию OpenFreeMap Outdoor (Of): описание тайлов (TileJSON) — свой ответ с адресом тайлов,
// как у настоящего (с версией сборки), тайлы — фикстура browser-тестов, настоящий тайл z12 (src/test/tiles.ts)
const VECTOR_TILE_FIXTURE = fileURLToPath(new URL('../src/test/openfreemap-tile.pbf', import.meta.url));
const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet/fixture/';
const OPENFREEMAP_TILEJSON_BODY = JSON.stringify({
    tilejson: '3.0.0',
    tiles: [`${OPENFREEMAP_TILES}{z}/{x}/{y}.pbf`],
    minzoom: 0,
    maxzoom: 14,
});
// сохранённые ответы поисковиков (src/search/fixtures/, 2026-10-09)
const MAPYCZ_FIXTURE = fileURLToPath(new URL('../src/search/fixtures/mapycz-mtatsminda.json', import.meta.url));
const PHOTON_FIXTURE = fileURLToPath(new URL('../src/search/fixtures/photon-mtatsminda.json', import.meta.url));
// адреса прокси и хранилища треков клона — те же, что в сборке (vite build --mode clone)
export const CORS_PROXY_URL = makeConfig('clone').corsProxyUrl;
export const TRACKS_STORAGE = makeConfig('clone').tracksStorageServer;
// vite preview of the build, the same address as baseURL in playwright.config.ts
const PREVIEW_ORIGIN = 'http://localhost:4173';
// сервис высот клона: в тестах отвечает заглушка, высота — функция широты (elevationAt)
export const ELEVATION_SERVER = makeConfig('clone').elevationsServer;
export const elevationAt = (lat: number) => Math.round((lat - 41.6) * 10000 * 100) / 100;
// сервер своего слоя в тестах: выдуманный хост, ответы — фикстура
export const CUSTOM_TILE_HOST = 'tiles.example.test';
// загрузчик рантайма CheerpJ клона (CDN Leaning Technologies)
export const CHEERPJ_LOADER = makeConfig('clone').routingEngineRuntimeUrl;

// Заглушка рантайма CheerpJ вместо настоящего с CDN (design add-web-route-editor, «Тесты»): те же глобальные
// cheerpjInit и cheerpjRunLibrary, а WasmRouter.route отвечает GeoJSON без расчёта — прямая с изломом далеко в сторону
// (так проложенный отрезок заметно длиннее прямой). Отрезок, конец которого севернее NO_ROUTE_LAT, падает исключением
// «Java» с текстом BRouter про отсутствующий тайл. Воркер движка, его протокол и очередь при этом настоящие.
//
// Запросы importScripts из воркера context.route Playwright перехватывает не всегда: воркер успевает сходить в сеть до
// того, как к нему подключился перехват, и тогда грузится настоящий рантайм с CDN (проверено 2026-10-09: cj3.wasm,
// 11/lib/modules). Поэтому подменяется сам скрипт воркера — его запрашивает страница: перед кодом воркера встаёт
// importScripts, который вместо загрузчика CheerpJ выполняет заглушку и в сеть не ходит. Адрес CDN тоже отвечает
// заглушкой — для запасного пути на главном потоке.
export const NO_ROUTE_LAT = 41.692;
const FAKE_CHEERPJ = `
self.cheerpjInit = async () => {};
self.cheerpjRunLibrary = async () => ({
    WasmRouter: Promise.resolve({
        async route(segmentDir, profileDir, query) {
            const [from, to] = new URLSearchParams(query).get('lonlats').split('|').map((p) => p.split(',').map(Number));
            if (from[1] > ${NO_ROUTE_LAT} || to[1] > ${NO_ROUTE_LAT}) {
                throw { getMessage: async () => 'datafile E40_N45.rd5 not found' };
            }
            const middle = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2 - 0.01];
            return JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [from, middle, to] } }] });
        },
    }),
});
`;
const WORKER_PRELUDE = `
(() => {
    const realImportScripts = self.importScripts.bind(self);
    self.importScripts = (...urls) => {
        for (const url of urls) {
            if (url === ${JSON.stringify(CHEERPJ_LOADER)}) {
                ${FAKE_CHEERPJ}
            } else {
                realImportScripts(url);
            }
        }
    };
})();
`;
const ENGINE_WORKER = /\/assets\/engine\.worker-[^/]+\.js$/;

// Заглушка Maps JavaScript API (design add-web-search-panoramas, «Тесты»): те же глобальные google.maps, что зовёт
// src/streetview/google.ts, без сети. Панорамы — в точках STREET_VIEW_PANORAMAS, ближайшая в радиусе; окно — div
// google-panorama с видом в data-view. Колбэк загрузки — из параметра callback адреса скрипта.
export const GOOGLE_MAPS_API = 'https://maps.googleapis.com/maps/api/js';
export const STREET_VIEW_PANORAMAS = [
    { lat: 41.693, lng: 44.78 },
    { lat: 41.6935, lng: 44.781 },
];
const FAKE_GOOGLE_MAPS = `
(() => {
    const panoramas = ${JSON.stringify(STREET_VIEW_PANORAMAS)};
    class LatLng {
        constructor(lat, lng) { this.a = lat; this.b = lng; }
        lat() { return this.a; }
        lng() { return this.b; }
    }
    class StreetViewPanorama {
        constructor(container) {
            this.listeners = {};
            this.position = null;
            this.pov = { heading: 0, pitch: 0 };
            this.zoom = 1;
            this.element = document.createElement('div');
            this.element.dataset.testid = 'google-panorama';
            container.append(this.element);
            window.__panorama = this;
        }
        addListener(event, handler) { (this.listeners[event] ||= []).push(handler); }
        fire(event) { for (const handler of this.listeners[event] || []) handler(); }
        render() {
            const p = this.position;
            this.element.dataset.view = p ? p.lat.toFixed(5) + ',' + p.lng.toFixed(5) + ',' + this.pov.heading : '';
        }
        getPosition() { return this.position && new LatLng(this.position.lat, this.position.lng); }
        setPosition(position) { this.position = position; this.render(); this.fire('position_changed'); }
        getPov() { return this.pov; }
        setPov(pov) { this.pov = pov; this.render(); this.fire('pov_changed'); }
        getZoom() { return this.zoom; }
        setZoom(zoom) { this.zoom = zoom; }
        setVisible() {}
    }
    class StreetViewService {
        getPanorama(request, callback) {
            const { lat, lng } = request.location;
            const meters = (p) => Math.hypot(p.lat - lat, (p.lng - lng) * Math.cos((lat * Math.PI) / 180)) * 111320;
            const nearest = panoramas.slice().sort((a, b) => meters(a) - meters(b))[0];
            const found = nearest && meters(nearest) <= request.radius;
            setTimeout(() => callback(found ? { location: { latLng: new LatLng(nearest.lat, nearest.lng) } } : null, found ? 'OK' : 'ZERO_RESULTS'));
        }
    }
    window.google = { maps: {
        StreetViewPanorama,
        StreetViewService,
        StreetViewPreference: { NEAREST: 'nearest' },
        StreetViewStatus: { OK: 'OK' },
        event: { trigger() {}, clearInstanceListeners() {} },
    } };
    const callback = new URL(document.currentScript.src).searchParams.get('callback');
    window[callback]();
})();
`;

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Шаблон адреса тайла → регулярка: токены MapLibre — числа и квадключ, {ratio} — необязательный @2x, язык
// подписей Google — любой (в браузере теста navigator.language свой), {date} снимков по датам — любая дата
function templateToRegExp(template: string) {
    const pattern = escapeRegExp(template)
        .replace(/\\\{[zxy]\\\}/g, '\\d+')
        .replace(/\\\{quadkey\\\}/g, '[0-3]*')
        .replace(/\\\{ratio\\\}/g, '(?:@2x)?')
        .replace(/\\\{date\\\}/g, '\\d{4}-\\d{2}-\\d{2}')
        .replace(/hl=LANG/g, 'hl=[^&]*');
    return new RegExp(`^${pattern}$`);
}

// Каталог тем же модулем, что приложение: и обычный, и retina (адреса Strava отличаются px=)
const LAYER_TILES: [code: string, pattern: RegExp][] = [1, 2].flatMap((pixelRatio) =>
    buildCatalog({ pixelRatio, language: 'LANG', corsProxyUrl: CORS_PROXY_URL }).flatMap((layer) =>
        (layer.source.tiles ?? []).map((template): [string, RegExp] => [layer.code, templateToRegExp(template)]),
    ),
);
LAYER_TILES.push([COVERAGE_CODE, templateToRegExp(COVERAGE_TILES)]);
const CUSTOM_TILE = new RegExp(`^https://${escapeRegExp(CUSTOM_TILE_HOST)}/`);
const PROXIED_CUSTOM_TILE = new RegExp(`^${escapeRegExp(CORS_PROXY_URL)}https/${escapeRegExp(CUSTOM_TILE_HOST)}/`);

interface Network {
    // запрошенные тайлы: код слоя (или 'custom') и адрес
    tiles: { code: string; url: string }[];
    // запросы мимо localhost и подменённых тайлов: тест обязан закончиться с пустым списком
    external: string[];
    // внешние запросы по-прежнему обрываются, но тест не валят: старые ссылки несут свои слои на чужих серверах
    // и ссылки на файлы треков, ответы на которые тесту не нужны
    allowExternal(): void;
    // адреса тайлов слоя
    tilesOf(code: string): string[];
    // ответить ошибкой 503 на тайлы слоя
    failTiles(code: string): void;
    // сервер своего слоя отвечает без CORS (как многие частные серверы тайлов)
    customWithoutCors(): void;
    // хранилище треков (POST/GET /track/{key}) в памяти: ключ → тело
    storage: Map<string, string>;
    // тела запросов к сервису высот (POST строк «lat lng»); ответ — elevationAt по широте
    elevationRequests: string[];
    // ответ прокси клона на адрес (импорт по ссылке): файл фикстуры или статус
    proxyResponds(url: string, response: { path?: string; body?: string; status?: number }): void;
    // сколько раз запущен воркер движка с заглушкой CheerpJ (или отдана заглушка загрузчика главному потоку)
    engineLoads: number;
    // запросы к CDN CheerpJ, которые увидел браузер: с заглушкой их быть не должно
    cdnRequests: string[];
    // та же сеть для другого контекста браузера (другой пользователь со своим IndexedDB, но общим хранилищем треков)
    attach(context: BrowserContext): Promise<void>;
    // запросы поиска: mapy.cz через прокси и photon — сохранёнными ответами или заданным статусом
    searchRequests: string[];
    searchResponds(service: 'mapycz' | 'photon', response: { status: number }): void;
    // адреса загрузки Maps JavaScript API (заглушка FAKE_GOOGLE_MAPS)
    googleApiLoads: string[];
    // тела конвертов, принятых вместо Sentry (сборка с DSN, спека clone-monitoring)
    sentryEnvelopes: string[];
    // serve the build of vite preview under real host names (the move between two origins, e2e/move.spec.ts):
    // each host is its own origin with its own storage; /__seed__ on it is an empty page for writing test data
    serveSite(...hosts: string[]): void;
    // забрать принятые конверты: тест, который ждёт отчёт, забирает его, остальные к концу обязаны остаться без отчётов
    takeSentryEnvelopes(): string[];
}

// приём отчётов Sentry: o<организация>.ingest.sentry.io, с регионом — o<…>.ingest.us.sentry.io, o<…>.ingest.de.sentry.io.
// Сборка деплоя несёт настоящий DSN, check-web — поддельный o0: заглушка принимает оба
const SENTRY_INGEST = /^o\d+\.ingest\.(?:[a-z]+\.)?sentry\.io$/;

// Сеть теста: localhost — как есть, хранилище треков — в памяти, сервис высот — заглушка, прокси — заданные ответы, тайлы слоёв каталога и
// своего слоя — фикстура с CORS (или ошибка), всё остальное обрывается и валит тест в конце. Так e2e не ходит к
// провайдерам и сервисам и ловит лишние внешние запросы.
// auto: фикстура Playwright ленивая, и тест, который не просит network в аргументах, иначе шёл бы без перехвата —
// в настоящую сеть (так было до 2026-10-09 у тестов вида `async ({ page }) =>`)
// Список треков в приложении закрыт до кнопки Tracks (макет 4a, design polish-web-ui), а e2e списка и редактора нужен
// открытым: после каждого goto и reload страницы приложения фикстура его открывает. Страница без приложения (стенд
// движка, редирект) кнопки не дождётся — тогда ничего.
export async function openTracks(page: Page) {
    // не страница приложения или верхняя строка — редактор линии или точек: кнопки Tracks нет
    if (
        !page.url().startsWith('http') ||
        (await page.locator('[data-testid="edit-panel"], [data-testid="point-panel"]').count())
    ) {
        return;
    }
    const button = page.getByRole('button', { name: /^Tracks( \d+)?$/ });
    try {
        await button.waitFor({ timeout: 5_000 });
    } catch {
        return;
    }
    if ((await button.getAttribute('aria-expanded')) !== 'true') {
        await button.click();
    }
}

export const test = base.extend<{ network: Network; tracksOpen: boolean }>({
    // false — список не открывается сам после goto и reload (тест открывает его openTracks, где нужно)
    tracksOpen: [true, { option: true }],
    page: async ({ page, tracksOpen }, use) => {
        if (!tracksOpen) {
            await use(page);
            return;
        }
        const goto = page.goto.bind(page);
        const reload = page.reload.bind(page);
        page.goto = async (...args) => {
            const response = await goto(...args);
            await openTracks(page);
            return response;
        };
        page.reload = async (...args) => {
            const response = await reload(...args);
            await openTracks(page);
            return response;
        };
        await use(page);
    },
    network: [
        async ({ context }, use) => {
            const failing = new Set<string>();
            let customCors = true;
            let externalAllowed = false;
            const siteHosts = new Set<string>();
            const proxied = new Map<string, { path?: string; body?: string; status?: number }>();
            const searchStatus: Record<'mapycz' | 'photon', number> = { mapycz: 200, photon: 200 };
            const network: Network = {
                searchRequests: [],
                searchResponds: (service, response) => {
                    searchStatus[service] = response.status;
                },
                googleApiLoads: [],
                sentryEnvelopes: [],
                takeSentryEnvelopes: () => network.sentryEnvelopes.splice(0),
                engineLoads: 0,
                cdnRequests: [],
                storage: new Map(),
                elevationRequests: [],
                proxyResponds: (url, response) => {
                    proxied.set(CORS_PROXY_URL + url.replace(/^(https?):\/\//, '$1/'), response);
                },
                tiles: [],
                external: [],
                tilesOf: (code) => network.tiles.filter((tile) => tile.code === code).map((tile) => tile.url),
                failTiles: (code) => {
                    failing.add(code);
                },
                customWithoutCors: () => {
                    customCors = false;
                },
                allowExternal: () => {
                    externalAllowed = true;
                },
                attach: async (other) => {
                    await intercept(other);
                },
                serveSite: (...hosts) => {
                    for (const host of hosts) {
                        siteHosts.add(host);
                    }
                },
            };
            async function intercept(target: BrowserContext) {
                target.on('request', (request) => {
                    if (new URL(request.url()).hostname.endsWith('leaningtech.com')) {
                        network.cdnRequests.push(request.url());
                    }
                });
                await target.route('**/*', async (route) => {
                    const url = route.request().url();
                    const { hostname, pathname, origin } = new URL(url);
                    if (siteHosts.has(hostname)) {
                        if (pathname === '/__seed__') {
                            return route.fulfill({
                                status: 200,
                                body: '<!doctype html><title>seed</title>',
                                contentType: 'text/html',
                            });
                        }
                        const response = await route.fetch({ url: url.replace(origin, PREVIEW_ORIGIN) });
                        return ENGINE_WORKER.test(pathname)
                            ? route.fulfill({ response, body: WORKER_PRELUDE + (await response.text()) })
                            : route.fulfill({ response });
                    }
                    if (hostname === 'localhost') {
                        if (ENGINE_WORKER.test(new URL(url).pathname)) {
                            network.engineLoads += 1;
                            const response = await route.fetch();
                            return route.fulfill({ response, body: WORKER_PRELUDE + (await response.text()) });
                        }
                        return route.continue();
                    }
                    // CORS отражённым Origin, как у Worker'ов клона (route.fulfill браузер на CORS не проверяет, но пусть
                    // ответ будет как настоящий)
                    // загрузчик — до чтения заголовков: importScripts воркера идёт без CORS, а headerValue ждёт сырые заголовки
                    if (url === CHEERPJ_LOADER) {
                        network.engineLoads += 1;
                        return route.fulfill({ status: 200, body: FAKE_CHEERPJ, contentType: 'text/javascript' });
                    }
                    const cors = {
                        'Access-Control-Allow-Origin': (await route.request().headerValue('origin')) ?? '*',
                    };
                    if (url.startsWith(GOOGLE_MAPS_API)) {
                        network.googleApiLoads.push(url);
                        return route.fulfill({ status: 200, body: FAKE_GOOGLE_MAPS, contentType: 'text/javascript' });
                    }
                    if (SENTRY_INGEST.test(new URL(url).hostname)) {
                        // preflight тоже сюда: ответ с CORS, тело конверта — только у POST
                        if (route.request().method() === 'POST') {
                            network.sentryEnvelopes.push(route.request().postData() ?? '');
                        }
                        return route.fulfill({ status: 200, body: '{}', headers: cors });
                    }
                    const searchService = url.startsWith(`${CORS_PROXY_URL}https/pro.mapy.cz/suggest/`)
                        ? 'mapycz'
                        : url.startsWith('https://photon.komoot.io/api/')
                          ? 'photon'
                          : null;
                    if (searchService) {
                        network.searchRequests.push(url);
                        const status = searchStatus[searchService];
                        return status === 200
                            ? route.fulfill({
                                  status,
                                  path: searchService === 'mapycz' ? MAPYCZ_FIXTURE : PHOTON_FIXTURE,
                                  contentType: 'application/json',
                                  headers: cors,
                              })
                            : route.fulfill({ status, body: 'error', headers: cors });
                    }
                    if (url.startsWith(`${TRACKS_STORAGE}/track/`)) {
                        const key = url.slice(`${TRACKS_STORAGE}/track/`.length);
                        if (route.request().method() === 'POST') {
                            network.storage.set(key, route.request().postData() ?? '');
                            return route.fulfill({ status: 200, body: '', headers: cors });
                        }
                        const body = network.storage.get(key);
                        return body === undefined
                            ? route.fulfill({ status: 404, body: 'not found', headers: cors })
                            : route.fulfill({ status: 200, body, contentType: 'text/plain', headers: cors });
                    }
                    if (url === ELEVATION_SERVER && route.request().method() === 'POST') {
                        const body = route.request().postData() ?? '';
                        network.elevationRequests.push(body);
                        const rows = body.split('\n').map((row) => elevationAt(Number.parseFloat(row)).toFixed(2));
                        return route.fulfill({
                            status: 200,
                            body: rows.join('\n'),
                            contentType: 'text/plain',
                            headers: cors,
                        });
                    }
                    // OpenFreeMap: описание и тайлы — один слой Of; failTiles('Of') роняет оба, как недоступный сервис
                    if (url === OPENFREEMAP_TILEJSON || url.startsWith(OPENFREEMAP_TILES)) {
                        network.tiles.push({ code: 'Of', url });
                        if (failing.has('Of')) {
                            return route.fulfill({ status: 503, body: 'unavailable', headers: cors });
                        }
                        return url === OPENFREEMAP_TILEJSON
                            ? route.fulfill({
                                  body: OPENFREEMAP_TILEJSON_BODY,
                                  contentType: 'application/json',
                                  headers: cors,
                              })
                            : route.fulfill({
                                  path: VECTOR_TILE_FIXTURE,
                                  contentType: 'application/x-protobuf',
                                  headers: cors,
                              });
                    }
                    const proxiedResponse = proxied.get(url);
                    if (proxiedResponse) {
                        return route.fulfill({
                            status: proxiedResponse.status ?? 200,
                            ...proxiedResponse,
                            headers: cors,
                        });
                    }
                    const proxiedCustom = PROXIED_CUSTOM_TILE.test(url);
                    const custom = !proxiedCustom && CUSTOM_TILE.test(url);
                    const code =
                        proxiedCustom || custom ? 'custom' : LAYER_TILES.find(([, pattern]) => pattern.test(url))?.[0];
                    if (!code) {
                        if (!externalAllowed) {
                            network.external.push(url);
                        }
                        return route.abort();
                    }
                    network.tiles.push({ code, url });
                    // Сервер без CORS: на ответ route.fulfill браузер CORS не проверяет, поэтому CORS-запрос (fetch с
                    // mode: 'cors', тайл MapLibre) обрывается — для страницы это та же TypeError, что и отказ CORS;
                    // no-cors запрос получает ответ. Отличаем по Origin: Chromium шлёт его только в CORS-запросе
                    // (Sec-Fetch-Mode перехват Playwright не показывает)
                    if (custom && !customCors && (await route.request().headerValue('origin'))) {
                        return route.abort();
                    }
                    // WebGL берёт растр только с CORS: подменённый ответ несёт заголовок, как настоящие серверы слоёв
                    if (failing.has(code)) {
                        return route.fulfill({ status: 503, body: 'unavailable', headers: cors });
                    }
                    return route.fulfill({ path: TILE_FIXTURE, contentType: 'image/png', headers: cors });
                });
            }
            await intercept(context);
            await use(network);
            expect(network.external, 'запросы мимо localhost и подменённых тайлов').toEqual([]);
            expect(network.cdnRequests, 'запросы к CDN CheerpJ мимо заглушки').toEqual([]);
            // на сборке с DSN — сценарий «Заход без ошибок» спеки clone-monitoring во всех e2e: прокладка, профиль,
            // слои, поиск не дают отчётов
            expect(network.sentryEnvelopes, 'отчёты Sentry, которых тест не ждал').toEqual([]);
        },
        { auto: true },
    ],
});

export { expect };
