import { fileURLToPath } from 'node:url';
import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';
import { makeConfig } from '../src/config.ts';
import { buildCatalog, OPENFREEMAP_TILEJSON } from '../src/layers/catalog.ts';
import { COVERAGE_CODE, COVERAGE_TILES } from '../src/streetview/coverage.ts';

const TILE_FIXTURE = fileURLToPath(new URL('../src/test/tile.png', import.meta.url));
// the default vector basemap OpenFreeMap Outdoor (Of): the tile description (TileJSON) is our own answer with a tile
// URL as in the real one (with a build version), the tiles are the browser test fixture, a real z12 tile
// (src/test/tiles.ts)
const VECTOR_TILE_FIXTURE = fileURLToPath(new URL('../src/test/openfreemap-tile.pbf', import.meta.url));
const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet/fixture/';
const OPENFREEMAP_TILEJSON_BODY = JSON.stringify({
    tilejson: '3.0.0',
    tiles: [`${OPENFREEMAP_TILES}{z}/{x}/{y}.pbf`],
    minzoom: 0,
    maxzoom: 14,
});
// saved answers of the search providers (src/search/fixtures/, 2026-10-09)
const MAPYCZ_FIXTURE = fileURLToPath(new URL('../src/search/fixtures/mapycz-mtatsminda.json', import.meta.url));
const PHOTON_FIXTURE = fileURLToPath(new URL('../src/search/fixtures/photon-mtatsminda.json', import.meta.url));
// the URLs of the proxy and the track storage of the clone are the same as in the build (vite build --mode clone)
export const CORS_PROXY_URL = makeConfig('clone').corsProxyUrl;
export const TRACKS_STORAGE = makeConfig('clone').tracksStorageServer;
// vite preview of the build, the same address as baseURL in playwright.config.ts
const PREVIEW_ORIGIN = 'http://localhost:4173';
// elevation service of the clone: in the tests a stub answers, the elevation is a function of latitude (elevationAt)
export const ELEVATION_SERVER = makeConfig('clone').elevationsServer;
export const elevationAt = (lat: number) => Math.round((lat - 41.6) * 10000 * 100) / 100;
// server of the custom layer in the tests: an invented host, the answers are a fixture
export const CUSTOM_TILE_HOST = 'tiles.example.test';
// loader of the CheerpJ runtime of the clone (CDN of Leaning Technologies)
export const CHEERPJ_LOADER = makeConfig('clone').routingEngineRuntimeUrl;

// Stub of the CheerpJ runtime in place of the real one from the CDN (design add-web-route-editor, «Тесты»): the same
// globals cheerpjInit and cheerpjRunLibrary, and WasmRouter.route answers with GeoJSON without a calculation: a line
// with a bend far to the side (so a routed segment is much longer than the straight line). A segment with an end north
// of NO_ROUTE_LAT fails with a «Java» exception with the BRouter text about a missing tile. The engine worker, its
// protocol and its queue are real.
//
// Playwright context.route does not always intercept the importScripts requests from the worker: the worker can go to
// the network before the interception connects to it, and then the real runtime loads from the CDN (checked 2026-10-09:
// cj3.wasm, 11/lib/modules). So the fixture replaces the worker script itself, which the page requests: before the
// worker code it puts an importScripts that runs the stub in place of the CheerpJ loader and does not go to the
// network. The CDN address also answers with the stub, for the fallback on the main thread.
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

// Stub of the Maps JavaScript API (design add-web-search-panoramas, «Тесты»): the same globals google.maps that
// src/streetview/google.ts calls, without the network. The panoramas are at the points STREET_VIEW_PANORAMAS, the
// nearest one in the radius; the window is a div google-panorama with the view in data-view. The load callback comes
// from the parameter callback of the script URL.
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

// Tile URL template → regular expression: the MapLibre tokens are numbers and a quadkey, {ratio} is an optional @2x,
// the Google label language is any (the test browser has its own navigator.language), {date} of the dated imagery is
// any date
function templateToRegExp(template: string) {
    const pattern = escapeRegExp(template)
        .replace(/\\\{[zxy]\\\}/g, '\\d+')
        .replace(/\\\{quadkey\\\}/g, '[0-3]*')
        .replace(/\\\{ratio\\\}/g, '(?:@2x)?')
        .replace(/\\\{date\\\}/g, '\\d{4}-\\d{2}-\\d{2}')
        .replace(/hl=LANG/g, 'hl=[^&]*');
    return new RegExp(`^${pattern}$`);
}

// The catalog from the same module as the app: both the regular one and retina (the Strava URLs differ in px=)
const LAYER_TILES: [code: string, pattern: RegExp][] = [1, 2].flatMap((pixelRatio) =>
    buildCatalog({ pixelRatio, language: 'LANG', corsProxyUrl: CORS_PROXY_URL }).flatMap((layer) =>
        (layer.source.tiles ?? []).map((template): [string, RegExp] => [layer.code, templateToRegExp(template)]),
    ),
);
LAYER_TILES.push([COVERAGE_CODE, templateToRegExp(COVERAGE_TILES)]);
const CUSTOM_TILE = new RegExp(`^https://${escapeRegExp(CUSTOM_TILE_HOST)}/`);
const PROXIED_CUSTOM_TILE = new RegExp(`^${escapeRegExp(CORS_PROXY_URL)}https/${escapeRegExp(CUSTOM_TILE_HOST)}/`);

interface Network {
    // requested tiles: the layer code (or 'custom') and the URL
    tiles: { code: string; url: string }[];
    // requests that are not to localhost and not to replaced tiles: the test must end with an empty list
    external: string[];
    // external requests are still aborted, but they do not fail the test: old links have custom layers on third-party
    // servers and links to track files, and the test does not need the answers
    allowExternal(): void;
    // tile URLs of a layer
    tilesOf(code: string): string[];
    // answer the tiles of a layer with error 503
    failTiles(code: string): void;
    // the server of the custom layer answers without CORS (as many private tile servers do)
    customWithoutCors(): void;
    // track storage (POST/GET /track/{key}) in memory: key → body
    storage: Map<string, string>;
    // bodies of the requests to the elevation service (POST of «lat lng» lines); the answer is elevationAt by latitude
    elevationRequests: string[];
    // answer of the clone proxy for a URL (import by link): a fixture file or a status
    proxyResponds(url: string, response: { path?: string; body?: string; status?: number }): void;
    // how many times the engine worker started with the CheerpJ stub (or the loader stub went to the main thread)
    engineLoads: number;
    // requests to the CheerpJ CDN that the browser saw: with the stub there must be none
    cdnRequests: string[];
    // the same network for a different browser context (a different user with own IndexedDB, but shared track storage)
    attach(context: BrowserContext): Promise<void>;
    // search requests: mapy.cz through the proxy and photon, with saved answers or a given status
    searchRequests: string[];
    searchResponds(service: 'mapycz' | 'photon', response: { status: number }): void;
    // load URLs of the Maps JavaScript API (stub FAKE_GOOGLE_MAPS)
    googleApiLoads: string[];
    // bodies of the envelopes received in place of Sentry (build with a DSN, spec clone-monitoring)
    sentryEnvelopes: string[];
    // serve the build of vite preview under real host names (the move between two origins, e2e/move.spec.ts):
    // each host is its own origin with its own storage; /__seed__ on it is an empty page for writing test data
    serveSite(...hosts: string[]): void;
    // take the received envelopes: a test that expects a report takes it, all other tests must end without reports
    takeSentryEnvelopes(): string[];
}

// Sentry report intake: o<organization>.ingest.sentry.io, with a region o<…>.ingest.us.sentry.io,
// o<…>.ingest.de.sentry.io. The deploy build has the real DSN, check-web has the fake o0: the stub accepts both
const SENTRY_INGEST = /^o\d+\.ingest\.(?:[a-z]+\.)?sentry\.io$/;

// The track list in the app is closed until the button Tracks (mockup 4a, design polish-web-ui), but the e2e of the
// list and the editor need it open: after each goto and reload of an app page the fixture opens it. A page without the
// app (engine bench, redirect) does not get the button, then the fixture does nothing.
export async function openTracks(page: Page) {
    // not an app page, or the top bar is the line or point editor: there is no button Tracks
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
    // false: the list does not open itself after goto and reload (the test opens it with openTracks where necessary)
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
    // Test network: localhost as is, the track storage in memory, the elevation service a stub, the proxy given
    // answers, the tiles of the catalog layers and of the custom layer a fixture with CORS (or an error), all else is
    // aborted and fails the test at the end. Thus e2e does not go to the providers and services, and catches extra
    // external requests.
    // auto: a Playwright fixture is lazy, and a test that does not ask for network in its arguments would else run
    // without interception, into the real network (this was so before 2026-10-09 for tests of the form
    // `async ({ page }) =>`)
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
                    // WebKit also routes the blob: URL of the maplibre-contour worker (Chromium does not). It is a
                    // local object of the page, and its hostname is empty, so the checks below would abort it
                    if (url.startsWith('blob:')) {
                        return route.continue();
                    }
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
                    // CORS with the reflected Origin, as the Workers of the clone do (the browser does not check
                    // CORS on route.fulfill, but the answer must look real)
                    // the loader comes before the header read: the worker importScripts goes without CORS, and
                    // headerValue waits for the raw headers
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
                        // the preflight also comes here: an answer with CORS, only a POST has an envelope body
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
                    // OpenFreeMap: the description and the tiles are one layer Of; failTiles('Of') fails both, as an
                    // unavailable service
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
                    // Server without CORS: the browser does not check CORS on a route.fulfill answer, so a CORS request
                    // (fetch with mode: 'cors', a MapLibre tile) is aborted: for the page it is the same TypeError as a
                    // CORS denial; a no-cors request gets the answer. The difference is the Origin: Chromium sends it
                    // only in a CORS request (the Playwright interception does not show Sec-Fetch-Mode)
                    if (custom && !customCors && (await route.request().headerValue('origin'))) {
                        return route.abort();
                    }
                    // WebGL takes a raster only with CORS: the replaced answer has the header, as real layer servers do
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
            // on a build with a DSN, the scenario «Заход без ошибок» of the spec clone-monitoring in all e2e: routing,
            // profile, layers, search give no reports
            expect(network.sentryEnvelopes, 'отчёты Sentry, которых тест не ждал').toEqual([]);
        },
        { auto: true },
    ],
});

export { expect };
