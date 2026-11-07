import { CORS_PROXY_URL, CUSTOM_TILE_HOST, expect, test } from './fixtures.ts';

// The test titles are the scenarios of the spec map-layers (openspec/specs/map-layers/spec.md). The tiles of all layers
// are a fixture (e2e/fixtures.ts).

const canvas = '.maplibregl-canvas';

// code of a custom layer in the old client format: -cs + URL-safe base64 of the JSON of the form fields
function customLayerCode(fields: Record<string, unknown>) {
    return `-cs${btoa(JSON.stringify(fields)).replace(/\+/g, '-').replace(/\//g, '_')}`;
}

const CUSTOM_OVERLAY = customLayerCode({
    name: 'Custom overlay',
    url: `https://${CUSTOM_TILE_HOST}/{z}/{x}/{y}.png`,
    tms: false,
    scaleDependent: false,
    maxZoom: 18,
    isOverlay: true,
    isTop: true,
});

function hashOf(page: { url(): string }) {
    return new URL(page.url()).hash;
}

async function openSwitcher(page: import('@playwright/test').Page) {
    await page.getByTestId('layers-button').click();
    const switcher = page.getByTestId('layer-switcher');
    await expect(switcher).toBeVisible();
    return switcher;
}

test('Первый заход без настроек', async ({ page, network }) => {
    await page.goto('./');
    await expect.poll(() => hashOf(page)).toBe('#m=13/42.37889/45.63000&l=Of');
    await expect.poll(() => network.tilesOf('Of').some((url) => url.endsWith('.pbf'))).toBe(true);
    // only OpenFreeMap: the first visit does not use the Tracestrack quota
    expect(network.tiles.every((tile) => tile.code === 'Of')).toBe(true);
});

test('Старая ссылка с OpenStreetMap', async ({ page, network }) => {
    await page.goto('./#m=8/49.73868/33.45886&l=O');
    await expect.poll(() => network.tilesOf('O').length).toBeGreaterThan(0);
    expect(network.tilesOf('Tt')).toEqual([]);
    expect(network.tilesOf('Of')).toEqual([]);
});

test('Слой Tracestrack', async ({ page, network }) => {
    await page.goto('./#m=8/49.73868/33.45886&l=Tt');
    await expect.poll(() => network.tilesOf('Tt').length).toBeGreaterThan(0);
    for (const url of network.tilesOf('Tt')) {
        expect(url.startsWith(`${CORS_PROXY_URL}https/tile.tracestrack.com/topo_en/`)).toBe(true);
        expect(url).not.toContain('key=');
    }
    await expect(page.getByRole('link', { name: 'Maps © Tracestrack' })).toBeVisible();
});

test('Нет ключа или квоты', async ({ page, network }) => {
    network.failTiles('Tt');
    await page.goto('./#m=8/49.73868/33.45886&l=Tt/Hs');
    await expect(page.getByText('Tracestrack Topo is unavailable')).toBeVisible();
    await expect(page.getByText('Switched to OpenStreetMap')).toBeVisible();
    await expect.poll(() => network.tilesOf('O').length).toBeGreaterThan(0);
    // the address has the user selection, OSM only shows until a reload
    expect(hashOf(page)).toBe('#m=8/49.73868/33.45886&l=Tt/Hs');
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
});

test('OpenFreeMap недоступен', async ({ page, network }) => {
    network.failTiles('Of');
    await page.goto('./#m=8/49.73868/33.45886&l=Of/Hs');
    await expect(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
    await expect(page.getByText('Switched to Tracestrack Topo')).toBeVisible();
    await expect.poll(() => network.tilesOf('Tt').length).toBeGreaterThan(0);
    // the address has the basemap from which the fallback started
    expect(hashOf(page)).toBe('#m=8/49.73868/33.45886&l=Of/Hs');
    await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
});

test('Следующий заход после отката', async ({ page, network }) => {
    network.failTiles('Of');
    await page.goto('./');
    await expect(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
    await page.reload();
    await expect(page.getByText('OpenFreeMap Outdoor is unavailable')).toBeVisible();
    await page.goto('about:blank');
    const before = network.tiles.length;
    await page.goto('./');
    // the saved selection is still OpenFreeMap: both a reload and a new visit request it again
    await expect.poll(() => network.tiles.slice(before).some((tile) => tile.code === 'Of')).toBe(true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nakarte-web:layers') ?? '{}'));
    expect(saved.selection.base).toBe('Of');
});

test('Список слоёв', async ({ page }) => {
    await page.goto('./');
    const switcher = await openSwitcher(page);
    await switcher.getByText('Configure layers').click();
    const dialog = page.getByRole('dialog');
    // the 36 catalog layers without the five buttons of the column (design custom-bases-in-list)
    await expect(dialog.getByRole('checkbox')).toHaveCount(31);
    await expect(dialog.getByRole('checkbox').first()).toHaveAccessibleName('Tracestrack Topo');
    for (const title of ['Yandex map', 'Yandex Satellite', 'Wikimapia', 'Soviet topo maps grid']) {
        await expect(dialog.getByText(title, { exact: true })).toHaveCount(0);
    }
    await expect(dialog.getByText('Relief shading')).toBeVisible();
});

test('Ссылка со слоями', async ({ page, network }) => {
    await page.goto('./#m=13/49.80930/86.47562&l=Otm/Wp');
    await expect.poll(() => hashOf(page)).toBe('#m=13/49.80930/86.47562&l=Otm');
    await expect.poll(() => network.tilesOf('Otm').length).toBeGreaterThan(0);
    expect(network.tilesOf('O')).toEqual([]);
});

test('Ссылка с Sentinel-2', async ({ page, network }) => {
    await page.goto('./#m=11/42.66000/44.64000&l=S2');
    await expect.poll(() => network.tilesOf('S2').length).toBeGreaterThan(0);
    // directly from EOX: no tile goes through the clone proxy
    expect(network.tiles.some((tile) => tile.url.startsWith(CORS_PROXY_URL))).toBe(false);
    expect(network.tilesOf('Tt')).toEqual([]);
    expect(hashOf(page)).toContain('l=S2');
});

test('Ссылка с удалённым слоем', async ({ page, network }) => {
    for (const layers of ['O/F', 'O/Wp']) {
        await page.goto(`./#m=8/49.73868/33.45886&l=${layers}`);
        await expect.poll(() => hashOf(page)).toBe('#m=8/49.73868/33.45886&l=O');
    }
    await expect(page.locator(canvas)).toBeVisible();
    expect(network.tiles.every((tile) => tile.code === 'O')).toBe(true);
});

test('Ссылка только с удалённым слоем', async ({ page, network }) => {
    for (const layers of ['F', 'Y']) {
        await page.goto(`./#m=8/49.73868/33.45886&l=${layers}`);
        await expect.poll(() => hashOf(page)).toBe('#m=8/49.73868/33.45886&l=Of');
    }
    await expect.poll(() => network.tilesOf('Of').length).toBeGreaterThan(0);
});

test('Ссылка со своим слоем', async ({ page, network }) => {
    await page.goto(`./#m=8/49.73868/33.45886&l=O/${CUSTOM_OVERLAY}`);
    await expect.poll(() => network.tilesOf('custom').length).toBeGreaterThan(0);
    expect(network.tilesOf('custom').every((url) => url.startsWith(`https://${CUSTOM_TILE_HOST}/`))).toBe(true);
    const switcher = await openSwitcher(page);
    await expect(switcher.getByRole('checkbox', { name: 'Custom overlay' })).toBeChecked();
});

test('Перезагрузка без l=', async ({ page, network }) => {
    await page.goto('./');
    // the catalog basemaps are in the circles of the column (design custom-bases-in-list)
    await page.getByRole('button', { name: 'ESRI Satellite', exact: true }).click();
    const switcher = await openSwitcher(page);
    await switcher.getByText('Relief shading').click();
    await expect.poll(() => hashOf(page)).toContain('l=E/Hs');
    await page.goto('about:blank');
    await page.goto('./');
    await expect.poll(() => hashOf(page)).toBe('#m=13/42.37889/45.63000&l=E/Hs');
    await expect.poll(() => network.tilesOf('Hs').length).toBeGreaterThan(0);
});

test('Сохранённые настройки со старыми кодами', async ({ page }) => {
    const legacy = {
        layers: [
            { code: 'T', isCustom: false, enabled: true, hotkey: null },
            { code: 'F', isCustom: false, enabled: true, hotkey: null },
            { code: 'Wp', isCustom: false, enabled: true, hotkey: null },
            { code: 'Co', isCustom: false, enabled: false, hotkey: null },
            { code: CUSTOM_OVERLAY, isCustom: true, enabled: true, hotkey: null },
        ],
    };
    await page.addInitScript((value) => {
        if (!localStorage.getItem('nakarte-web:layers')) {
            localStorage.setItem('leafletLayersSettings', value);
        }
    }, JSON.stringify(legacy));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    const switcher = await openSwitcher(page);
    await expect(switcher.getByText('Custom overlay')).toBeVisible();
    // the hidden basemap Co is not in the menu of its circle (design custom-bases-in-list)
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Topo layers', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Topo layers' });
    await expect(menu.getByRole('menuitemradio', { name: 'OpenFreeMap Outdoor' })).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'CyclOSM' })).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('Слой Strava', async ({ page, network }) => {
    await page.goto('./#m=8/49.73868/33.45886&l=O/Sa');
    await expect.poll(() => network.tilesOf('Sa').length).toBeGreaterThan(0);
    for (const url of network.tilesOf('Sa')) {
        expect(url.startsWith(`${CORS_PROXY_URL}https/content-a.strava.com/`)).toBe(true);
    }
});

test('Горизонтали из рельефа', async ({ page, network }) => {
    // the production path: the maplibre-contour Blob worker loads the terrain, the same fixture intercepts its
    // requests. The Terrarium template is shared with the relief shading, so the tiles are recorded under Hs; m=14
    // gives contour and terrain tiles of z13
    await page.goto('./#m=14/42.66000/44.64000&l=O/Ct');
    await expect.poll(() => network.tilesOf('Hs').length).toBeGreaterThan(0);
    expect(network.tilesOf('Hs').every((url) => url.includes('/terrarium/13/'))).toBe(true);
    expect(hashOf(page)).toContain('l=O/Ct');
    await expect(page.getByRole('link', { name: 'Terrain: Mapzen, sources' })).toBeAttached();
});

test('Региональный слой вне покрытия', async ({ page, network }) => {
    await page.goto('./#m=15/41.68700/44.77600&l=O/Nm');
    await expect.poll(() => network.tilesOf('O').length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    expect(network.tilesOf('Nm')).toEqual([]);
});

test('Слой с минимальным зумом', async ({ page, network }) => {
    await page.goto('./#m=10/54.45900/-3.02400&l=O/Gbt');
    await expect.poll(() => network.tilesOf('O').length).toBeGreaterThan(0);
    await page.waitForLoadState('networkidle');
    expect(network.tilesOf('Gbt')).toEqual([]);
    const switcher = await openSwitcher(page);
    await expect(switcher.getByText('zoom ≥ 12')).toBeVisible();
});

test.describe('свой слой без CORS', () => {
    async function addCustomLayer(page: import('@playwright/test').Page) {
        await page.goto('./');
        const switcher = await openSwitcher(page);
        await switcher.getByText('Add custom layer').click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Tile url template').fill(`https://${CUSTOM_TILE_HOST}/{z}/{x}/{y}.png`);
        await dialog.getByText('Overlay', { exact: true }).click();
        await dialog.getByRole('button', { name: 'Add layer' }).click();
        return dialog;
    }

    test('Сервер без CORS', async ({ page, network }) => {
        network.customWithoutCors();
        const dialog = await addCustomLayer(page);
        await expect(dialog.getByRole('alert')).toContainText('no CORS');
        await expect(dialog.getByRole('checkbox', { name: 'Use proxy' })).toBeVisible();
    });

    test('Слой через прокси', async ({ page, network }) => {
        network.customWithoutCors();
        const dialog = await addCustomLayer(page);
        await expect(dialog.getByRole('alert')).toContainText('no CORS');
        await dialog.getByRole('checkbox', { name: 'Use proxy' }).click();
        await dialog.getByRole('button', { name: 'Add layer' }).click();
        await expect(dialog).toHaveCount(0);
        await expect
            .poll(() => network.tilesOf('custom').filter((url) => url.startsWith(CORS_PROXY_URL)).length)
            .toBeGreaterThan(1);
        await expect(page.getByText('Map tiles failed to load')).toHaveCount(0);
    });
});
