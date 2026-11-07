import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { parseRedirects, resolveRedirect } from '../vite/redirects.ts';
import { expect, openTracks, test } from './fixtures.ts';

// The test titles are the scenarios of the spec web-client (openspec/specs/web-client/spec.md).

// the z/x/y tile that contains the point: the Web Mercator formula from the OSM wiki (Slippy map tilenames)
function tileOf(lat: number, lng: number, zoom: number) {
    const n = 2 ** zoom;
    const latRad = (lat * Math.PI) / 180;
    const x = Math.floor(((lng + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
    return `${zoom}/${x}/${y}`;
}

// the vector tiles of the default basemap in the fixture network (e2e/fixtures.ts)
const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet/fixture/';

const canvas = '.maplibregl-canvas';

test('Открыть приложение', async ({ page, network }) => {
    const scripts: string[] = [];
    page.on('request', (request) => {
        if (['script', 'stylesheet'].includes(request.resourceType())) {
            scripts.push(new URL(request.url()).pathname);
        }
    });
    await page.goto('./');
    await expect(page).toHaveTitle('trailroutine');
    await expect(page.locator(canvas)).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
    for (const path of scripts) {
        expect(path).toMatch(/^\/assets\//);
    }
    expect(network.external).toEqual([]);
});

test('Стенд движка', async ({ page }) => {
    await page.goto('/engine-bench.html');
    await expect(page).toHaveTitle('engine bench');
});

// vite preview does not read the _redirects file: on /next/… the page gets the answer that Pages would give by the
// rules of public/_redirects (checked with wrangler pages dev on 2026-10-09). The browser keeps the # through the
// redirect.
const REDIRECTS = parseRedirects(readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8'));

async function servePagesRedirects(page: Page) {
    await page.route(
        (url) => url.hostname === 'localhost' && resolveRedirect(REDIRECTS, url.pathname) !== null,
        (route) => {
            const redirect = resolveRedirect(REDIRECTS, new URL(route.request().url()).pathname);
            return route.fulfill({ status: redirect?.status, headers: { location: redirect?.location ?? '/' } });
        },
    );
}

test('Ссылка на /next/ с параметрами', async ({ page, network }) => {
    await servePagesRedirects(page);
    await page.goto('/next/#m=13/42.68490/47.07008&l=O');
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).hash).toBe('#m=13/42.68490/47.07008&l=O');
    await expect
        .poll(() => network.tilesOf('O'))
        .toContain(`https://tile.openstreetmap.org/${tileOf(42.6849, 47.07008, 13)}.png`);
});

test('Стенд по старому адресу', async ({ page }) => {
    await servePagesRedirects(page);
    await page.goto('/next/engine-bench.html');
    expect(new URL(page.url()).pathname).toBe('/engine-bench.html');
    await expect(page).toHaveTitle('engine bench');
});

// Real nakarte.me links (the fixture of the address parsing) and the parameters of removed features that «Copy link» of
// the old client copied together with # (research new-ui, item 6): j= (JNX), min= and autoprofile (embedding), sid=
// (session).
const OLD_LINKS = readFileSync(new URL('../src/state/fixtures/old-links.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('https://'))
    .map((line) => line.slice(line.indexOf('#')));
const REMOVED_FEATURE_LINKS = [
    '#m=12/41.69/44.78&l=O&j=10/12/41.6/44.7/41.8/44.9',
    '#m=12/41.69/44.78&l=O&min=1&autoprofile',
    '#m=12/41.69/44.78&l=O&sid=kq3f1x_abc123',
];
const REMOVED_PARAMS = ['p', 'j', 'min', 'autoprofile', 'sid', 'q'];
// saveNktk of the track «Mtatsminda» (e2e/tracks.spec.ts): as a string, e2e builds as a Node module and does not import
// src/tracks/
const MTATSMINDA = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';
// nktl key from the fixture of old links
const STORED_KEY = 'KYOMJFo4WrootHEbXrMSTA';
// OSM answer for track 3376100 (src/tracks/fixtures/README.md)
const OSM_TRACE = fileURLToPath(new URL('../src/tracks/fixtures/services/osm-3376100.gpx', import.meta.url));
const TRACK_LINKS: [hash: string, track: string][] = [
    [`#m=12/41.7/44.8&l=O&nktk=${MTATSMINDA}`, 'Mtatsminda'],
    [`#m=12/41.7/44.8&l=O&nktl=${STORED_KEY}`, 'Mtatsminda'],
    [
        `#m=12/41.7/44.8&l=O&nktu=${encodeURIComponent('https://www.openstreetmap.org/user/Wladich/traces/3376100')}`,
        'Test - Тест - Zkouška',
    ],
    ['#m=12/41.7/44.8&l=O&nktp=41.7/44.8/Tbilisi', 'Tbilisi'],
];

test.describe('старые ссылки', () => {
    // to open the list after each of tens of links costs extra seconds on a slow CI: only the tracks need it
    test.use({ tracksOpen: false });

    test('Набор реальных старых ссылок', async ({ page, network }) => {
        test.slow();
        // custom layers of the links on third-party servers and track files by links: the requests are aborted, the
        // test only needs the app to open without exceptions
        network.allowExternal();
        const errors: string[] = [];
        // Playwright WebKit reports the harmless window error «ResizeObserver loop completed with undelivered
        // notifications.» as pageerror; Sentry also ignores it by default
        page.on('pageerror', (error) => {
            if (!/^ResizeObserver loop/.test(error.message)) {
                errors.push(error.message);
            }
        });
        for (const hash of [...OLD_LINKS, ...REMOVED_FEATURE_LINKS]) {
            // through about:blank: a navigation from one # to another does not reload the page
            await page.goto('about:blank');
            await page.goto(`/${hash}`);
            await expect(page.locator(canvas), hash).toBeVisible();
            const params = new URLSearchParams(hash.slice(1));
            const after = new URLSearchParams(new URL(page.url()).hash.slice(1));
            for (const key of REMOVED_PARAMS) {
                expect(after.get(key), `${key} в ${hash}`).toBe(params.get(key));
            }
            // the view from m= stays (the app format has 5 digits after the decimal point)
            const view = /^(\d+)\/(-?\d+\.\d+)\/(-?\d+\.\d+)$/.exec(params.get('m') ?? '');
            if (view) {
                const [zoom, lat, lng] = (after.get('m') ?? '').split('/');
                expect([zoom, Number(lat).toFixed(4), Number(lng).toFixed(4)], hash).toEqual([
                    view[1],
                    Number(view[2]).toFixed(4),
                    Number(view[3]).toFixed(4),
                ]);
            }
            expect(errors, hash).toEqual([]);
        }
        expect(OLD_LINKS.length).toBeGreaterThan(50);

        // tracks and a panorama from the parameters of old links: the storage and the proxy answer with stubs of the
        // fixture network
        network.storage.set(STORED_KEY, MTATSMINDA);
        network.proxyResponds('https://www.openstreetmap.org/trace/3376100/data', { path: OSM_TRACE });
        for (const [hash, name] of TRACK_LINKS) {
            await page.goto('about:blank');
            await page.goto(`/${hash}`);
            await openTracks(page);
            await expect(
                page.getByRole('list', { name: 'Tracks' }).getByRole('button', { name, exact: true }).first(),
                hash,
            ).toBeVisible();
        }
        await page.goto('about:blank');
        await page.goto('/#m=17/41.6935/44.781&l=O&n=41.693500/44.781000/45.0/0.0/1.0');
        await expect.poll(() => new URL(page.url()).hash).toMatch(/[#&]n2=_g\/g\/41\.6935/);
        expect(errors).toEqual([]);
    });
});

test('Иконка сайта', async ({ page }) => {
    await page.goto('./');
    const href = (selector: string) => page.locator(selector).getAttribute('href');
    expect(await href('link[rel="icon"][type="image/svg+xml"]')).toBe('/favicon.svg');
    expect(await href('link[rel="icon"][sizes]')).toBe('/favicon.ico');
    expect(await href('link[rel="apple-touch-icon"]')).toBe('/apple-touch-icon.png');
    // the server of the build serves the files from web/public (vite preview, Pages in production)
    for (const [path, type] of [
        ['favicon.svg', 'image/svg+xml'],
        ['favicon.ico', 'image/'],
        ['apple-touch-icon.png', 'image/png'],
    ]) {
        const response = await page.request.get(path);
        expect(response.status(), path).toBe(200);
        expect(response.headers()['content-type'], path).toContain(type);
    }
    // content: the ICO has three images of 16, 32 and 48 px (the width field of each directory entry), the PNG is
    // 180×180 by the IHDR header
    const ico = await (await page.request.get('favicon.ico')).body();
    const count = ico.readUInt16LE(4);
    expect(Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i))).toEqual([16, 32, 48]);
    const touch = await (await page.request.get('apple-touch-icon.png')).body();
    expect([touch.readUInt32BE(16), touch.readUInt32BE(20)]).toEqual([180, 180]);
});

test('Первый заход', async ({ page, network }) => {
    await page.goto('./');
    await expect(page.getByRole('link', { name: 'OpenFreeMap', exact: true })).toBeVisible();
    // vector tile of 512 px: at MapLibre zoom 12 (m=13) the tile is z12
    await expect.poll(() => network.tilesOf('Of')).toContain(`${OPENFREEMAP_TILES}${tileOf(42.37889, 45.63, 12)}.pbf`);
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
    const box = await page.locator(canvas).boundingBox();
    const viewport = page.viewportSize();
    expect(box).toMatchObject({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });
});

test.describe('на телефоне', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('Окно телефона', async ({ page }) => {
        await page.goto('./');
        await expect(page.locator(canvas)).toBeVisible();
        const box = await page.locator(canvas).boundingBox();
        expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
        const scroll = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            height: document.documentElement.scrollHeight,
        }));
        expect(scroll).toEqual({ width: 390, height: 844 });
    });
});

test('Сервер тайлов недоступен', async ({ page, network }) => {
    network.failTiles('O');
    await page.goto('./#l=O');
    await expect(page.getByText('Map tiles failed to load')).toBeVisible();
    await expect(page.locator('[data-slot="toast-description"]')).toHaveText('OpenStreetMap');
    await expect.poll(() => network.tilesOf('O').length).toBeGreaterThan(1);
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(1);
    await expect(page.locator(canvas)).toBeVisible();
});

test('Ошибка подложки Tracestrack', async ({ page, network }) => {
    network.failTiles('Tt');
    await page.goto('./#m=8/49.73868/33.45886&l=Tt');
    await expect(page.getByText('Tracestrack Topo is unavailable')).toBeVisible();
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
    await expect(page.locator(canvas)).toBeVisible();
});

test('Ошибка подложки OpenFreeMap', async ({ page, network }) => {
    network.failTiles('Of');
    await page.goto('./');
    await expect(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
    await expect(page.locator(canvas)).toBeVisible();
});

test.describe('в тёмной теме системы', () => {
    test.use({ colorScheme: 'dark' });

    test('Тёмная тема системы', async ({ page, network }) => {
        // the toast of the default basemap fallback: any toast is sufficient for the theme check
        network.failTiles('Of');
        await page.goto('./');
        // the glass of the search bar, the toast and the layers button is light (--glass in index.css), not dark
        const panel = page.getByTestId('search-bar');
        await expect(panel).toBeVisible();
        await expect(panel).toHaveCSS('background-color', 'oklch(1 0 0 / 0.74)');
        await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
        const toast = page.locator('[data-slot="toast"]');
        await expect(toast).toBeVisible();
        await expect(toast).toHaveCSS('background-color', 'oklch(1 0 0 / 0.74)');
        // the system theme does not turn on the dark: classes of shadcn components (@custom-variant dark in index.css)
        await expect(page.getByTestId('layers-button')).toHaveCSS('background-color', 'oklch(1 0 0 / 0.74)');
    });
});

test('Ссылка с видом', async ({ page, network }) => {
    await page.goto('./#m=13/42.68490/47.07008&l=O');
    await expect
        .poll(() => network.tilesOf('O'))
        .toContain(`https://tile.openstreetmap.org/${tileOf(42.6849, 47.07008, 13)}.png`);
    expect(network.tilesOf('O').every((url) => url.includes('/13/'))).toBe(true);
});

test('Неверный вид в ссылке', async ({ page, network }) => {
    // the second address differs only in #: the page does not reload, the app gets hashchange
    for (const hash of ['#m=99/49.44893/52.5547', '#m=11/49.44893/']) {
        await page.goto(`./${hash}`);
        await expect.poll(() => new URL(page.url()).hash).toBe('#m=13/42.37889/45.63000&l=Of');
    }
    await expect.poll(() => network.tilesOf('Of')).toContain(`${OPENFREEMAP_TILES}${tileOf(42.37889, 45.63, 12)}.pbf`);
});

test('Вид пишется в адрес', async ({ page, network }) => {
    await page.goto('./#m=10/41/44&p=1');
    await expect.poll(() => new URL(page.url()).hash).toBe('#m=10/41.00000/44.00000&p=1&l=Of');
    // drag the map only after it loads: the first tiles are requested
    await expect.poll(() => network.tilesOf('Of').some((url) => url.endsWith('.pbf'))).toBe(true);
    const box = await page.locator(canvas).boundingBox();
    if (!box) {
        throw new Error('нет холста карты');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 + 100, { steps: 10 });
    await page.mouse.up();
    // the map moved to the south-west: the center is more north and more east, the zoom and the other parameters stay
    await expect.poll(() => new URL(page.url()).hash).not.toBe('#m=10/41.00000/44.00000&p=1&l=Of');
    expect(new URL(page.url()).hash).toMatch(/^#m=10\/41\.\d{5}\/44\.\d{5}&p=1&l=Of$/);
});
