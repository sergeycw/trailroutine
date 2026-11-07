import { devices, type Page } from '@playwright/test';
import { copiedLink, expect, type MapOffset, mapPoint, openTracks, test } from './fixtures.ts';

// Line tools and track points on the clone build: a real reload, IndexedDB and «Copy link» in a different browser
// context. The engine is the CheerpJ stub (e2e/fixtures.ts), its route goes to the side of the straight line. The test
// titles are the scenarios of the specs route-editing and tracks (design add-web-line-tools).

// Tbilisi, zoom 15 of the old client; the points are offsets from the map center (mapPoint in e2e/fixtures.ts). The
// points south of NO_ROUTE_LAT of the stub get a route.
const VIEW = './#m=15/41.69/44.785';
const START = { dx: -100, dy: 60 };
const MIDDLE = { dx: 0, dy: 110 };
const FINISH = { dx: 100, dy: 40 };
const SECOND_START = { dx: -80, dy: 200 };
const SECOND_FINISH = { dx: 120, dy: 240 };
const SPOT = { dx: 260, dy: 140 };

async function chooseActivity(page: Page, name: string) {
    await openTracks(page);
    await page
        .getByRole('button', { name: /^Routing/ })
        .first()
        .click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function clickMap(page: Page, offset: MapOffset, button: 'left' | 'right' = 'left') {
    const point = await mapPoint(page, offset);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button });
}

async function dragMap(page: Page, fromOffset: MapOffset, toOffset: MapOffset) {
    const from = await mapPoint(page, fromOffset);
    const to = await mapPoint(page, toOffset);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
}

async function menuItem(page: Page, name: string) {
    await page.getByTestId('map-menu').getByRole('menuitem', { name, exact: true }).click();
}

// The autosave record (database nakarte-web, design add-web-autosave): per track, the leg states of the route markup of
// each track segment (null is a polyline without markup) and the point names. Before a reload the test waits until the
// record gets to the database, else the reload is faster than the transaction.
interface Saved {
    legs: (string[] | null)[];
    points: string[];
}

function saved(page: Page) {
    return page.evaluate(
        () =>
            new Promise<Saved[] | null>((resolve) => {
                const request = indexedDB.open('nakarte-web');
                request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('autosave')) {
                        db.close();
                        resolve(null);
                        return;
                    }
                    const get = db.transaction('autosave').objectStore('autosave').get('tracks');
                    get.onsuccess = () => {
                        db.close();
                        type Track = {
                            routes: ({ legs: { state: string }[] } | null)[];
                            points: { name: string }[];
                        };
                        const tracks = (get.result?.tracks ?? null) as Track[] | null;
                        resolve(
                            tracks?.map((track) => ({
                                legs: track.routes.map((route) => route?.legs.map((leg) => leg.state) ?? null),
                                points: track.points.map((point) => point.name),
                            })) ?? null,
                        );
                    };
                };
                request.onerror = () => resolve(null);
            }),
    );
}

// length of the first track: while the line is in editing, from the editor in the top bar (the list is closed then),
// else from the list
async function kilometers(page: Page) {
    const editing = page.getByTestId('edit-length');
    if (await editing.count()) {
        return Number.parseFloat((await editing.textContent()) ?? '');
    }
    await openTracks(page);
    const text = await page.getByRole('list', { name: 'Tracks' }).getByTestId('track-length').first().textContent();
    return Number.parseFloat(text ?? '');
}

// a click on the line is caught from the drawn frame: right after the track loads, the frame can be missing
async function startEditing(page: Page, at: MapOffset) {
    await expect(async () => {
        await clickMap(page, at);
        await expect(page.getByTestId('edit-panel')).toBeVisible({ timeout: 1000 });
    }).toPass();
}

// Track START–MIDDLE–FINISH, routed with «Hiking»; the drawing is finished, the editing continues
async function drawRouted(page: Page) {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await chooseActivity(page, 'Hiking');
    await page.getByRole('button', { name: 'New track' }).first().click();
    for (const point of [START, MIDDLE, FINISH]) {
        await clickMap(page, point);
    }
    await expect.poll(() => saved(page)).toEqual([{ legs: [['routed', 'routed']], points: [] }]);
    await page.keyboard.press('Escape');
}

test('Перезагрузка после разреза', async ({ page, network }) => {
    await drawRouted(page);
    await clickMap(page, MIDDLE, 'right');
    await menuItem(page, 'Cut');
    await page.getByRole('button', { name: 'Finish editing' }).click();
    await chooseActivity(page, 'Off: straight lines');
    await expect.poll(() => saved(page)).toEqual([{ legs: [['routed'], ['routed']], points: [] }]);
    await page.reload();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    // routing is off, but a drag of the end of the second half goes to the engine: its markup is a route
    const loads = network.engineLoads;
    await startEditing(page, FINISH);
    await dragMap(page, FINISH, { dx: 140, dy: 80 });
    await expect.poll(() => network.engineLoads).toBe(loads + 1);
    await expect.poll(() => saved(page)).toEqual([{ legs: [['routed'], ['routed']], points: [] }]);
});

test('Ссылка после склейки', async ({ page, context, browser, browserName, network }) => {
    // only Chromium has the clipboard permissions (copiedLink in e2e/fixtures.ts)
    if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    await drawRouted(page);
    await page.getByRole('button', { name: 'Finish editing' }).click();
    // second segment of the same track
    await openTracks(page);
    await page.getByRole('button', { name: 'Actions for New track' }).click();
    await page.getByRole('menuitem', { name: 'Add segment' }).click();
    await clickMap(page, SECOND_START);
    await clickMap(page, SECOND_FINISH);
    await expect.poll(() => saved(page)).toEqual([{ legs: [['routed', 'routed'], ['routed']], points: [] }]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Join from the end of the first segment to the start of the second
    await startEditing(page, START);
    await clickMap(page, FINISH, 'right');
    await menuItem(page, 'Join');
    await clickMap(page, SECOND_START);
    const joined = [{ legs: [['routed', 'routed', 'straight', 'routed']], points: [] }];
    await expect.poll(() => saved(page)).toEqual(joined);
    await page.getByRole('button', { name: 'Finish editing' }).click();

    await openTracks(page);

    await page.getByRole('button', { name: 'Tracks menu' }).click();
    await page.getByRole('menuitem', { name: 'Copy link for all tracks' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const link = await copiedLink(page, network);
    // a different user: own IndexedDB, the same track storage
    const other = await browser.newContext();
    try {
        await network.attach(other);
        const second = await other.newPage();
        await second.goto(link);
        await expect.poll(() => saved(second)).toEqual(joined);
        expect(await kilometers(second)).toBeCloseTo(await kilometers(page), 1);
    } finally {
        await other.close();
    }
});

test('Точка трека', async ({ page }) => {
    await drawRouted(page);
    // while the line is in editing, the top bar is the editor and the list does not open: Escape without drawing ends
    // the edit
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('edit-panel')).toHaveCount(0);
    await openTracks(page);
    await page.getByRole('button', { name: 'Actions for New track' }).click();
    await page.getByRole('menuitem', { name: 'Add point' }).click();
    await expect(page.getByTestId('edit-panel')).toHaveCount(0);
    await clickMap(page, SPOT);
    await expect(page.getByRole('textbox', { name: 'Point name' })).toHaveValue('001');
    await page.getByRole('textbox', { name: 'Point name' }).fill('Camp');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('point-panel')).toHaveCount(0);
    // the point on the map: a click on it opens a menu with the name
    await expect(async () => {
        await clickMap(page, SPOT);
        await expect(page.getByTestId('map-menu')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await menuItem(page, 'Rename');
    await page.getByRole('textbox', { name: 'Point name' }).fill('Pass');
    await page.keyboard.press('Enter');
    await expect.poll(() => saved(page)).toEqual([{ legs: [['routed', 'routed']], points: ['Pass'] }]);
    await page.reload();
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(async () => {
        await clickMap(page, SPOT);
        await expect(page.getByTestId('map-menu').getByText('Pass', { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass();
});

// A real touch (CDP Input.dispatchTouchEvent): after the finger is released the browser sends compatibility
// mousedown/click, and without preventDefault on touchend the Base UI menu closed at once (the synthetic TouchEvent of
// the browser tests does not catch this)
test('Долгое нажатие', async ({ browser, network }) => {
    const phone = await browser.newContext({ ...devices['Pixel 7'] });
    try {
        await network.attach(phone);
        await phone.addInitScript(() => localStorage.setItem('nakarte-web:routing-activity', ''));
        const page = await phone.newPage();
        await page.goto(VIEW);
        await expect(page.locator('.maplibregl-canvas')).toBeVisible();
        await page.getByRole('button', { name: 'New track' }).first().tap();
        const points = [
            { x: 120, y: 520 },
            { x: 200, y: 600 },
            { x: 280, y: 520 },
        ];
        for (const point of points) {
            await page.touchscreen.tap(point.x, point.y);
        }
        await expect.poll(() => saved(page)).toEqual([{ legs: [null], points: [] }]);
        const before = await kilometers(page);
        const cdp = await phone.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[1]] });
        await expect(page.getByTestId('map-menu')).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        // the menu stays open, the point did not move and no new point appeared
        await page.waitForTimeout(500);
        await expect(page.getByTestId('map-menu')).toBeVisible();
        await page.getByRole('menuitem', { name: 'Delete point' }).tap();
        await expect(page.getByTestId('map-menu')).toHaveCount(0);
        // the middle point is deleted: the line is straight between the end points
        await expect.poll(() => kilometers(page)).toBeLessThan(before);
        // outside editing, MapLibre itself detects a long press on the line (contextmenu of the map): the editing
        // starts, the line menu opens
        await page.getByRole('button', { name: 'Finish editing' }).tap();
        await expect(page.getByTestId('edit-panel')).toHaveCount(0);
        const onLine = { x: 200, y: 520 };
        // a hit on the line comes from the drawn frame: after Finish editing let the map draw again
        await page.waitForTimeout(800);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [onLine] });
        await expect(page.getByTestId('map-menu')).toBeVisible();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(500);
        await expect(page.getByTestId('map-menu')).toHaveCount(1);
        await expect(page.getByRole('menuitem', { name: 'Cut', exact: true })).toBeVisible();
        await expect(page.getByTestId('edit-panel')).toBeVisible();
    } finally {
        await phone.close();
    }
});
