import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { isoDay } from './dated';

const GIBS =
    /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/HLS_([LS])30_Nadir_BRDF_Adjusted_Reflectance\/default\/([\d-]+)\/GoogleMapsCompatible_Level12\/(\d+)\//;
const EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1/search?';
// Kazbegi
const AT = '42.7/44.6';

// Scene dates count from today: the rule "at least 3 days old" uses the real clock of the browser
function daysAgo(days: number): string {
    return isoDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}

const SCENES: [days: number, platform: string, cloud: number][] = [
    [2, 'sentinel-2b', 8.3],
    [5, 'sentinel-2a', 97.7],
    [5, 'sentinel-2b', 96.3],
    [7, 'sentinel-2c', 1.6],
];

function searchBody(scenes = SCENES) {
    return {
        type: 'FeatureCollection',
        features: scenes.map(([days, platform, cloud]) => ({
            properties: { datetime: `${daysAgo(days)}T08:08:00Z`, platform, 'eo:cloud_cover': cloud },
        })),
    };
}

// Earth Search: the answers come from responses in turn (the last one repeats), the requested addresses go to calls
function fakeEarthSearch(...responses: (() => Response)[]) {
    const calls: string[] = [];
    const fetch: typeof window.fetch = async (input) => {
        const url = String(input);
        if (!url.startsWith(EARTH_SEARCH)) {
            throw new TypeError(`no network in tests: ${url}`);
        }
        calls.push(url);
        return responses[Math.min(calls.length, responses.length) - 1]();
    };
    return { fetch, calls };
}

const ok = () => Response.json(searchBody());
const failure = () => new Response('', { status: 502 });

const dateButton = () => page.getByTestId('imagery-date');
const hashDate = () => new URLSearchParams(location.hash.slice(1)).get('d');

describe('Снимки по датам', () => {
    let tiles: FixtureTiles;

    // GIBS tiles: [satellite, date, zoom]
    const gibsTiles = () =>
        tiles.requested.flatMap((url) => {
            const match = GIBS.exec(url);
            return match ? [[match[1], match[2], Number(match[3])] as const] : [];
        });

    beforeEach(() => {
        // otherwise the layer settings (the selection and the memory of the column circles) pass from test to test
        localStorage.clear();
        tiles = fixtureTiles();
    });

    afterEach(async () => {
        await cleanup();
    });

    test('Снимок за дату из ссылки', async () => {
        const search = fakeEarthSearch(ok);
        const { map } = await renderApp(tiles, `#m=12/${AT}&l=Hls&d=2026-10-05`, {
            fetch: search.fetch,
            tracksOpen: false,
        });
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        const requested = gibsTiles();
        expect(new Set(requested.map(([satellite]) => satellite))).toEqual(new Set(['L', 'S']));
        expect(requested.every(([, date]) => date === '2026-10-05')).toBe(true);
        expect(hashDate()).toBe('2026-10-05');
        await expect.element(dateButton()).toHaveTextContent('Imagery date2026-10-05');
        const attribution = document.querySelector('.maplibregl-ctrl-attrib-inner')?.textContent ?? '';
        expect(attribution).toContain("NASA's Global Imagery Browse Services (GIBS)");
        expect(attribution).toContain('Copernicus Sentinel data 2026');
        expect(attribution).toContain('Landsat image courtesy of the U.S. Geological Survey');
        await expect
            .element(page.getByRole('link', { name: "NASA's Global Imagery Browse Services (GIBS)" }))
            .toBeInTheDocument();
        expect(search.calls).toEqual([]);
        expect(tiles.external).toEqual([]);
    });

    test('Дата по умолчанию', async () => {
        const search = fakeEarthSearch(ok);
        const { map } = await renderApp(tiles, `#m=12/${AT}&l=Hls`, { fetch: search.fetch, tracksOpen: false });
        // the scene less than 3 days old is skipped, the 97 % scene is cloudy: the newest clear scene is 7 days ago
        await expect.poll(hashDate).toBe(daysAgo(7));
        expect(search.calls).toHaveLength(1);
        const url = new URL(search.calls[0]);
        expect(JSON.parse(url.searchParams.get('intersects') ?? '')).toEqual({
            type: 'Point',
            coordinates: [44.6, 42.7],
        });
        await expect.element(dateButton()).toHaveTextContent(`Imagery date${daysAgo(7)}2%`);
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        expect(gibsTiles().length).toBeGreaterThan(0);
        expect(gibsTiles().every(([, date]) => date === daysAgo(7))).toBe(true);
        expect(tiles.external).toEqual([]);
    });

    test('Даты недоступны', async () => {
        const search = fakeEarthSearch(failure, ok);
        const { map } = await renderApp(tiles, `#m=12/${AT}&l=Hls`, { fetch: search.fetch, tracksOpen: false });
        await expect.element(dateButton()).toHaveTextContent('Imagery dateDates unavailable');
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        expect(gibsTiles()).toEqual([]);
        expect(hashDate()).toBeNull();
        // the list opens with a retry; an open after an error requests the dates again by itself
        await dateButton().click();
        await expect.poll(() => search.calls.length).toBe(2);
        await expect.poll(hashDate).toBe(daysAgo(7));
        await expect.poll(() => gibsTiles().length).toBeGreaterThan(0);
    });

    test('Даты недоступны: Retry повторяет запрос', async () => {
        const search = fakeEarthSearch(failure, failure, ok);
        await renderApp(tiles, `#m=12/${AT}&l=Hls`, { fetch: search.fetch, tracksOpen: false });
        await expect.element(dateButton()).toHaveTextContent('Imagery dateDates unavailable');
        await dateButton().click();
        const list = page.getByTestId('imagery-dates');
        await expect.element(list.getByRole('button', { name: 'Retry' })).toBeVisible();
        expect(search.calls).toHaveLength(2);
        await list.getByRole('button', { name: 'Retry' }).click();
        await expect.poll(hashDate).toBe(daysAgo(7));
        expect(search.calls).toHaveLength(3);
    });

    test('Выбор даты из списка', async () => {
        const search = fakeEarthSearch(ok);
        const { map } = await renderApp(tiles, `#m=12/${AT}&l=Hls&d=${daysAgo(7)}`, {
            fetch: search.fetch,
            tracksOpen: false,
        });
        await dateButton().click();
        const list = page.getByTestId('imagery-dates');
        await expect.element(list.getByRole('list', { name: 'Imagery dates' })).toBeVisible();
        const rows = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="imagery-dates"] [data-date]')];
        expect(rows.map((row) => row.dataset.date)).toEqual([daysAgo(2), daysAgo(5), daysAgo(7)]);
        expect(rows[0].textContent).toBe(`${daysAgo(2)}8%Sentinel-2 · may not be ready`);
        expect(rows[1].textContent).toBe(`${daysAgo(5)}96%Sentinel-2`);
        expect(rows.map((row) => row.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);

        await list.getByRole('button', { name: new RegExp(`^${daysAgo(5)}`) }).click();
        expect(hashDate()).toBe(daysAgo(5));
        await expect.element(list).not.toBeInTheDocument();
        await expect.poll(() => gibsTiles().some(([, date]) => date === daysAgo(5))).toBe(true);
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        expect(tiles.external).toEqual([]);
    });

    test('Другая дата', async () => {
        const search = fakeEarthSearch(ok);
        await renderApp(tiles, `#m=12/${AT}&l=Hls&d=${daysAgo(7)}`, { fetch: search.fetch, tracksOpen: false });
        await dateButton().click();
        // the input does not apply the date before Enter: otherwise a part of the date (month 1 of «10») is already a
        // date
        const other = page.getByLabelText('Other date');
        await other.fill('2025-08-01');
        expect(hashDate()).toBe(daysAgo(7));
        await expect.element(page.getByTestId('imagery-dates')).toBeVisible();
        await userEvent.keyboard('{Enter}');
        await expect.poll(hashDate).toBe('2025-08-01');
        await expect.poll(() => gibsTiles().some(([, date]) => date === '2025-08-01')).toBe(true);
        await expect.element(dateButton()).toHaveTextContent('Imagery date2025-08-01');
    });

    test('Другая подложка', async () => {
        const search = fakeEarthSearch(ok);
        await renderApp(tiles, `#m=12/${AT}&l=Hls&d=2026-10-05`, { fetch: search.fetch, tracksOpen: false });
        await expect.element(dateButton()).toBeVisible();
        // OpenStreetMap is a menu item of the standard map circle (design quick-layer-menus)
        await page.getByRole('button', { name: 'Map layers', exact: true }).click();
        await page.getByRole('menuitemradio', { name: 'OpenStreetMap' }).click();
        await expect.poll(hashDate).toBeNull();
        expect(new URLSearchParams(location.hash.slice(1)).get('l')).toBe('O');
        await expect.element(dateButton()).not.toBeInTheDocument();
    });

    test('Ошибка пустого тайла', async () => {
        // status 500, as GIBS answers for a date tile without imagery (mixed with a transparent PNG); /__status__/ is a
        // plugin in vitest.config.ts
        tiles.respond(GIBS, new URL('/__status__/500/gibs.png', location.href).href);
        const { map } = await renderApp(tiles, `#m=12/${AT}&l=Hls&d=2026-10-07`, {
            fetch: fakeEarthSearch(ok).fetch,
            tracksOpen: false,
        });
        await expect.poll(() => gibsTiles().length).toBeGreaterThan(0);
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        // the toast would appear asynchronously after the error: give it time
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(page.getByText('Map tiles failed to load').all()).toHaveLength(0);
    });

    test('Снимок на крупном зуме', async () => {
        const search = fakeEarthSearch(ok);
        const { map } = await renderApp(tiles, `#m=15/${AT}&l=Hls&d=2026-10-05`, {
            fetch: search.fetch,
            tracksOpen: false,
        });
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        expect(gibsTiles().length).toBeGreaterThan(0);
        expect(gibsTiles().every(([, , zoom]) => zoom === 12)).toBe(true);
    });

    describe('Снимки по датам кнопкой справа', () => {
        const quickButton = () => page.getByRole('button', { name: 'Satellite by date', exact: true });
        const layersParam = () => new URLSearchParams(location.hash.slice(1)).get('l');
        const quickBases = () =>
            [...document.querySelectorAll('fieldset button[aria-pressed]')]
                .map((button) => button.getAttribute('aria-label'))
                .filter((name) => name !== 'Satellite by date' && name !== 'Strava heatmap (all)');

        test('Снимки по датам кнопкой', async () => {
            const search = fakeEarthSearch(ok);
            await renderApp(tiles, `#m=12/${AT}&l=O`, { fetch: search.fetch, tracksOpen: false });
            await expect.element(quickButton()).toHaveAttribute('aria-pressed', 'false');
            await quickButton().click();
            await expect.poll(layersParam).toBe('Hls');
            await expect.element(quickButton()).toHaveAttribute('aria-pressed', 'true');
            await expect.element(dateButton()).toBeVisible();
            await quickButton().click();
            await expect.poll(layersParam).toBe('O');
            await expect.element(quickButton()).toHaveAttribute('aria-pressed', 'false');
            await expect.element(dateButton()).not.toBeInTheDocument();
        });

        test('Ссылка со снимками по датам', async () => {
            const search = fakeEarthSearch(ok);
            await renderApp(tiles, `#m=12/${AT}&l=Hls&d=2026-10-05`, { fetch: search.fetch, tracksOpen: false });
            await expect.element(quickButton()).toHaveAttribute('aria-pressed', 'true');
            expect(quickBases()).toEqual(['OpenFreeMap Outdoor', 'Google Map', 'ESRI Satellite']);
            // the link has no previous basemap: the second click returns the default basemap
            await quickButton().click();
            await expect.poll(layersParam).toBe('Of');
        });
    });
});
