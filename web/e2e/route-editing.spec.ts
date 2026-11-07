import type { Page } from '@playwright/test';
import { expect, type MapOffset, mapPoint, openTracks, test } from './fixtures.ts';

// The test titles are the scenarios of the specs route-editing and routing (openspec/specs/). The clone build
// calculates the route with the routing engine in the browser; a stub replaces the CheerpJ runtime from the CDN
// (e2e/fixtures.ts, FAKE_CHEERPJ), so the engine worker, its protocol and its queue are real, but there is no network.

// Tbilisi, zoom 15 of the old client; the points are offsets from the map center (mapPoint in e2e/fixtures.ts). The
// points below the center are south of NO_ROUTE_LAT of the stub and get a route, the point 160 px above the center is
// north of it, where there is «no routing data for this area».
const VIEW = './#m=15/41.69/44.785';
const START = { dx: -100, dy: 60 };
const FINISH = { dx: 100, dy: 20 };
const NO_DATA = { dx: 60, dy: -160 };

async function chooseActivity(page: Page, name: string) {
    await openTracks(page);
    await page
        .getByRole('button', { name: /^Routing/ })
        .first()
        .click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function clickMap(page: Page, offset: MapOffset) {
    const point = await mapPoint(page, offset);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
}

// track length: while the line is in editing, from the editor in the top bar (the list is closed then), else from the
// list
async function trackLength(page: Page) {
    const editing = page.getByTestId('edit-length');
    if (await editing.count()) {
        return editing;
    }
    await openTracks(page);
    return page.getByRole('list', { name: 'Tracks' }).getByTestId('track-length');
}

async function kilometers(page: Page) {
    return Number.parseFloat((await (await trackLength(page)).textContent()) ?? '');
}

test('Новый трек', async ({ page, network }) => {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await chooseActivity(page, 'Hiking');
    await page.getByRole('button', { name: 'New track' }).first().click();
    await clickMap(page, START);
    await clickMap(page, FINISH);
    // the straight line between the points is ≈ 0.7 km, the route of the stub goes to the side and is much longer
    await expect.poll(() => kilometers(page)).toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Finish editing' }).click();
    await expect(page.getByTestId('edit-panel')).toHaveCount(0);
    // the engine worker calculated the route, the runtime is a stub on the CDN address
    expect(page.workers().map((worker) => worker.url())).toContainEqual(expect.stringContaining('engine.worker'));
    expect(network.engineLoads).toBe(1);
});

test('Нет маршрута', async ({ page }) => {
    await page.goto(VIEW);
    await chooseActivity(page, 'Hiking');
    await page.getByRole('button', { name: 'New track' }).first().click();
    await clickMap(page, START);
    await clickMap(page, NO_DATA);
    await expect(page.getByText('Routing failed: no routing data for this area')).toBeVisible();
    // the segment stays a straight line between the waypoints: the length is that of the straight line
    await expect.poll(() => kilometers(page)).toBeLessThan(1);
    await expect.poll(() => kilometers(page)).toBeGreaterThan(0);
});

test('Отмена клика', async ({ page, network }) => {
    await page.goto(VIEW);
    await page.getByRole('button', { name: 'New track' }).first().click();
    await clickMap(page, START);
    await clickMap(page, FINISH);
    await expect.poll(() => kilometers(page)).toBeGreaterThan(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(await trackLength(page)).toHaveText('0.00 km');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect.poll(() => kilometers(page)).toBeGreaterThan(0);
    // routing is off: the engine runtime does not load
    expect(network.engineLoads).toBe(0);
});

test('Перезагрузка страницы', async ({ page }) => {
    await page.goto(VIEW);
    await chooseActivity(page, 'Mountain bike');
    await expect(page.getByRole('button', { name: 'Routing: Mountain bike' })).toBeVisible();
    await page.reload();
    await page
        .getByRole('button', { name: /^Routing/ })
        .first()
        .click();
    await expect(page.getByRole('menuitemradio', { name: 'Mountain bike' })).toHaveAttribute('aria-checked', 'true');
});
