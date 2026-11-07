import type { MapRef } from '@vis.gl/react-maplibre';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { App } from './App';
import { config } from './config';
// the test needs all styles of the app: it checks how Tailwind and the MapLibre CSS work together on one page
import './index.css';
import { fixtureContours } from './test/render-app';
import { type FixtureTiles, fixtureTiles } from './test/tiles';

// A real MapLibre map in Chromium; the tiles of all layers are a local fixture (src/test/tiles.ts), and the test does
// not use the network. The test titles are the scenarios of the specs web-client and map-layers.

// the plugin statusResponses in vitest.config.ts gives the answers with a given status
const UNAVAILABLE_URL = new URL('/__status__/503/tile.png', location.href).href;
const MISSING_URL = new URL('/__status__/404/tile.png', location.href).href;

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', location.pathname + location.search);
    tiles = fixtureTiles();
});

afterEach(() => {
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

async function renderApp(hash = '') {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    await fixtureContours(tiles);
    const mapRef = createRef<MapRef>();
    const screen = await render(<App transformRequest={tiles.transformRequest} mapRef={mapRef} />);
    await expect.poll(() => mapRef.current?.getMap().loaded(), { timeout: 10_000 }).toBe(true);
    // biome-ignore lint/style/noNonNullAssertion: the line above waits until the map loads
    return { screen, map: mapRef.current!.getMap() };
}

function centerOf(element: Element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

describe('Интерфейс поверх карты', () => {
    test('Контролы карты', async () => {
        await renderApp();
        const canvas = document.querySelector('.maplibregl-canvas') as HTMLCanvasElement;
        const container = document.querySelector('[data-testid="map"]') as HTMLElement;
        expect(canvas.getBoundingClientRect().width).toBeCloseTo(container.getBoundingClientRect().width, 0);
        expect(canvas.getBoundingClientRect().height).toBeCloseTo(container.getBoundingClientRect().height, 0);

        const zoomIn = document.querySelector('.maplibregl-ctrl-zoom-in') as HTMLElement;
        const { x, y } = centerOf(zoomIn);
        expect(zoomIn.contains(document.elementFromPoint(x, y))).toBe(true);
        // the attribution of the default basemap (OpenFreeMap Outdoor) is visible
        await expect.element(page.getByRole('link', { name: 'OpenFreeMap' })).toBeVisible();
    });

    test('Клик по панели', async () => {
        const { map } = await renderApp();
        // the floating panel is the search bar capsule at the top left
        const panel = page.getByTestId('search-bar');
        await expect.element(panel).toBeVisible();

        const panelElement = panel.element() as HTMLElement;
        const rect = panelElement.getBoundingClientRect();
        for (const [x, y] of [
            // the hit test of the corners uses border-radius: the capsule radius is 18 px, and the point (16, 16) is
            // almost the center of the corner arc
            [rect.left + 16, rect.top + 16],
            [rect.right - 16, rect.bottom - 16],
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
        ]) {
            expect(panelElement.contains(document.elementFromPoint(x, y))).toBe(true);
        }

        const before = map.getCenter();
        // near the search field, not on the buttons: the bar corners are round, and a click in the corner itself
        // would go to the map
        await userEvent.click(panelElement, { position: { x: 16, y: 16 } });
        await userEvent.dblClick(panelElement, { position: { x: 16, y: 16 } });
        expect(map.getCenter()).toEqual(before);
        expect(map.getZoom()).toBe(config.defaultZoom);
    });
});

describe('Тост при ошибке тайлов', () => {
    test('Сервер тайлов недоступен', async () => {
        tiles.respond(/tile\.openstreetmap\.org/, UNAVAILABLE_URL);
        const { map } = await renderApp('#l=O');
        await expect.element(page.getByText('Map tiles failed to load')).toBeVisible();
        await expect.element(page.getByText('OpenStreetMap', { exact: true })).toBeVisible();

        // new tiles give new errors, but there is still one toast
        map.jumpTo({ zoom: 10 });
        await expect.poll(() => map.loaded(), { timeout: 10_000 }).toBe(true);
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(1);
        expect(map.getZoom()).toBe(10);
    });

    test('Тайла нет в покрытии', async () => {
        tiles.respond(/waymarkedtrails/, MISSING_URL);
        const { map } = await renderApp('#l=O/Wh');
        await expect.poll(() => tiles.requested.some((url) => url.includes('waymarkedtrails'))).toBe(true);
        await expect.poll(() => map.loaded(), { timeout: 10_000 }).toBe(true);
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
        expect(map.getLayer('Wh')).toBeDefined();
    });
});

describe('Подложка Tracestrack', () => {
    const TRACESTRACK = /\/https\/tile\.tracestrack\.com\/topo_[a-z-]+\//;

    test('Атрибуция Tracestrack', async () => {
        await renderApp('#l=Tt');
        await expect.poll(() => tiles.requested.some((url) => TRACESTRACK.test(url))).toBe(true);
        expect(tiles.requested.some((url) => url.includes('tile.openstreetmap.org'))).toBe(false);
        expect(tiles.requested.some((url) => url.includes('key='))).toBe(false);
        await expect.element(page.getByRole('link', { name: 'Maps © Tracestrack' })).toBeVisible();
        await expect
            .element(page.getByRole('link', { name: '© OpenStreetMap contributors' }))
            .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
        // the full attribution text is from the terms of Tracestrack (design map-chrome)
        expect(document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent).toBe(
            "Data: © OpenStreetMap contributors, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM, ESA WorldCover; Maps © Tracestrack",
        );
        expect(location.hash).toContain('l=Tt');
    });

    test('Нет ключа или квоты', async () => {
        tiles.respond(TRACESTRACK, UNAVAILABLE_URL);
        const { map } = await renderApp('#m=8/41.7/44.8&l=Tt/Hs');
        await expect.element(page.getByText('Tracestrack Topo is unavailable')).toBeVisible();
        await expect.element(page.getByText('Switched to OpenStreetMap')).toBeVisible();
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
        await expect.poll(() => map.getLayer('O')).toBeDefined();
        expect(map.getLayer('Tt')).toBeUndefined();
        expect(map.getLayer('Hs')).toBeDefined();
        // a fallback is not a selection: the address and localStorage keep the Tracestrack basemap
        expect(location.hash).toContain('l=Tt/Hs');
        expect(JSON.parse(localStorage.getItem('nakarte-web:layers') ?? '').selection).toEqual({
            base: 'Tt',
            overlays: ['Hs'],
        });
        await expect.poll(() => tiles.requested.some((url) => url.includes('tile.openstreetmap.org'))).toBe(true);
    });

    test('Тайла нет', async () => {
        tiles.respond(TRACESTRACK, MISSING_URL);
        const { map } = await renderApp('#l=Tt');
        await expect.poll(() => tiles.requested.some((url) => TRACESTRACK.test(url))).toBe(true);
        await expect.poll(() => map.loaded(), { timeout: 10_000 }).toBe(true);
        expect(map.getLayer('Tt')).toBeDefined();
        expect(page.getByText('Tracestrack Topo is unavailable').all()).toHaveLength(0);
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
    });
});

describe('Подложка OpenFreeMap Outdoor', () => {
    const OPENFREEMAP = 'https://tiles.openfreemap.org/';
    const OPENFREEMAP_TILEJSON = /^https:\/\/tiles\.openfreemap\.org\/planet$/;
    const OPENFREEMAP_TILES = /\/planet\/fixture\/\d+\/\d+\/\d+\.pbf$/;
    const TRACESTRACK = /\/https\/tile\.tracestrack\.com\/topo_[a-z-]+\//;

    test('Первый заход без настроек', async () => {
        const { map } = await renderApp();
        await expect.poll(() => map.getLayer('Of-peaks')).toBeDefined();
        await expect.poll(() => tiles.requested.some((url) => OPENFREEMAP_TILES.test(url))).toBe(true);
        expect(tiles.requested.some((url) => TRACESTRACK.test(url))).toBe(false);
        expect(location.hash).toContain('l=Of');
    });

    // the tile description or the tiles: fallback to Tracestrack Topo, the selection does not change (spec map-layers,
    // «Откат подложки при ошибке тайлов»)
    test.each([
        ['описание тайлов', OPENFREEMAP_TILEJSON],
        ['тайлы', OPENFREEMAP_TILES],
    ])('OpenFreeMap недоступен: %s', async (_what, pattern) => {
        tiles.respond(pattern, UNAVAILABLE_URL);
        const { map } = await renderApp('#m=8/41.7/44.8&l=Of/Hs');
        await expect.element(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
        await expect.element(page.getByText('Switched to Tracestrack Topo')).toBeVisible();
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
        await expect.poll(() => map.getLayer('Tt')).toBeDefined();
        expect(map.getLayer('Hs')).toBeDefined();
        expect(location.hash).toContain('l=Of/Hs');
        expect(JSON.parse(localStorage.getItem('nakarte-web:layers') ?? '').selection).toEqual({
            base: 'Of',
            overlays: ['Hs'],
        });
        await expect.poll(() => tiles.requested.some((url) => TRACESTRACK.test(url))).toBe(true);
    });

    test('Описание тайлов пропало: 404 на TileJSON — тоже откат', async () => {
        // a closed or renamed OpenFreeMap address answers 404: this is not "no tile", there is no source at all
        tiles.respond(OPENFREEMAP_TILEJSON, MISSING_URL);
        const { map } = await renderApp('#m=8/41.7/44.8&l=Of');
        await expect.element(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
        await expect.poll(() => map.getLayer('Tt')).toBeDefined();
        expect(location.hash).toContain('l=Of');
    });

    test('Недоступны обе', async () => {
        tiles.respond(OPENFREEMAP_TILEJSON, UNAVAILABLE_URL);
        tiles.respond(TRACESTRACK, UNAVAILABLE_URL);
        const { map } = await renderApp('#m=8/41.7/44.8&l=Of');
        await expect.element(page.getByText('Tracestrack Topo is unavailable')).toBeVisible();
        await expect.poll(() => map.getLayer('O')).toBeDefined();
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
        expect(location.hash).toContain('l=Of');
        await expect.poll(() => tiles.requested.some((url) => url.includes('tile.openstreetmap.org'))).toBe(true);
    });

    // MapLibre treats a 404 of a vector tile as an empty tile and does not send an error: the test pins this behavior,
    // not the logic of App
    test('Тайла нет', async () => {
        tiles.respond(OPENFREEMAP_TILES, MISSING_URL);
        const { map } = await renderApp('#l=Of');
        await expect.poll(() => tiles.requested.some((url) => OPENFREEMAP_TILES.test(url))).toBe(true);
        await expect.poll(() => map.loaded(), { timeout: 10_000 }).toBe(true);
        expect(map.getLayer('Tt')).toBeUndefined();
        expect(page.getByText('OpenFreeMap Outdoor is unavailable').all()).toHaveLength(0);
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
    });

    test('Ссылка с OpenFreeMap Outdoor', async () => {
        const { map } = await renderApp('#m=12/42.69/44.52&l=Of');
        expect(tiles.requested).toContain('https://tiles.openfreemap.org/planet');
        await expect
            .poll(() => tiles.requested.some((url) => /\/planet\/fixture\/\d+\/\d+\/\d+\.pbf$/.test(url)))
            .toBe(true);
        // only the TileJSON and the tiles of OpenFreeMap: no fonts, sprites or rasters (afterEach checks external)
        expect(tiles.requested.every((url) => url.startsWith(OPENFREEMAP))).toBe(true);
        expect(map.getStyle().glyphs).toBeUndefined();
        expect(map.getStyle().sprite).toBeUndefined();
        // a style layer draws the peaks of the fixture (Kazbek and its neighbors)
        await expect.poll(() => map.queryRenderedFeatures({ layers: ['Of-peaks'] }).length).toBeGreaterThan(0);
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
        expect(location.hash).toContain('l=Of');
    });

    test('Атрибуция OpenFreeMap', async () => {
        await renderApp('#l=Of');
        await expect
            .element(page.getByRole('link', { name: 'OpenFreeMap' }))
            .toHaveAttribute('href', 'https://openfreemap.org');
        await expect
            .element(page.getByRole('link', { name: '© OpenMapTiles' }))
            .toHaveAttribute('href', 'https://www.openmaptiles.org/');
        await expect
            .element(page.getByRole('link', { name: 'OpenStreetMap' }))
            .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
        expect(document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent).toBe(
            'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
        );
    });
});

describe('Подложка Sentinel-2', () => {
    test('Атрибуция Sentinel-2', async () => {
        await renderApp('#l=S2');
        await expect.poll(() => tiles.requested.some((url) => url.startsWith('https://tiles.maps.eox.at/'))).toBe(true);
        expect(tiles.requested.some((url) => url.includes('tracestrack'))).toBe(false);
        expect(tiles.requested.some((url) => url.includes('nakarte-cors-proxy'))).toBe(false);
        await expect
            .element(page.getByRole('link', { name: 'https://cloudless.eox.at' }))
            .toHaveAttribute('href', 'https://cloudless.eox.at');
        await expect
            .element(page.getByRole('link', { name: 'CC BY-NC-SA 4.0' }))
            .toHaveAttribute('href', 'https://creativecommons.org/licenses/by-nc-sa/4.0/');
        // the full attribution text is from the terms of EOX, with the mosaic year (design add-sentinel-imagery)
        expect(document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent).toBe(
            'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), ' +
                'CC BY-NC-SA 4.0',
        );
        expect(location.hash).toContain('l=S2');
    });
});
