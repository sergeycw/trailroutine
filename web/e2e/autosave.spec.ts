import type { Page } from '@playwright/test';
import { expect, openTracks, test } from './fixtures.ts';

// Autosave with a real page reload and the real Chromium IndexedDB (each test has its own context, so its own
// database). The test titles are the scenarios of the specs route-editing and tracks. The engine is the CheerpJ stub
// (e2e/fixtures.ts): its route goes to the side of the straight line, so a routed segment is much longer than the
// straight line.

// Tbilisi, zoom 15 of the old client; window Desktop Chrome 1280×720. The points south of NO_ROUTE_LAT of the stub get
// a route.
const VIEW = './#m=15/41.69/44.785';
const START = { x: 540, y: 420 };
const FINISH = { x: 740, y: 380 };
const MOVED = { x: 760, y: 440 };

// saveNktk({name: 'Mtatsminda', segments: [[41.69, 44.79 → 41.695, 44.786]], points: [TV tower]}) and
// saveNktk({name: 'Narikala', segments: [[41.688, 44.808 → 41.6875, 44.81]]}): as strings, because e2e builds
// as a Node module (nodenext), and src/tracks/ imports without extensions
const MTATSMINDA = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';
const NARIKALA = 'RAoCEAESGwoITmFyaWthbGESDwoFopTtAS0SBpj0_gG6AQ==';

async function chooseActivity(page: Page, name: string) {
    await openTracks(page);
    await page
        .getByRole('button', { name: /^Routing/ })
        .first()
        .click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
}

async function clickMap(page: Page, point: { x: number; y: number }) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
}

async function dragMap(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
}

async function trackNames(page: Page) {
    await openTracks(page);
    return page
        .getByRole('list', { name: 'Tracks' })
        .getByRole('listitem')
        .getByRole('button', { name: /^Actions for/ });
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

// How many tracks are in the autosave record (database nakarte-web, design add-web-autosave): before a reload the test
// waits until the record gets to the database, else the reload is faster than the transaction
function savedTracks(page: Page) {
    return page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                const request = indexedDB.open('nakarte-web');
                request.onsuccess = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains('autosave')) {
                        db.close();
                        resolve(-1);
                        return;
                    }
                    const get = db.transaction('autosave').objectStore('autosave').get('tracks');
                    get.onsuccess = () => {
                        db.close();
                        resolve(get.result?.tracks?.length ?? -1);
                    };
                };
                request.onerror = () => resolve(-1);
            }),
    );
}

// Track START–FINISH, routed with «Hiking» in the engine worker; the drawing and the editing are finished, routing in
// the menu is off: after a reload the engine does not warm up itself, and only a drag shows its load
async function drawRouted(page: Page) {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await chooseActivity(page, 'Hiking');
    await page.getByRole('button', { name: 'New track' }).first().click();
    await clickMap(page, START);
    await clickMap(page, FINISH);
    // the straight line between the points is ≈ 0.7 km, the route of the stub is much longer
    await expect.poll(() => kilometers(page)).toBeGreaterThan(2);
    await page.getByRole('button', { name: 'Finish editing' }).click();
    await expect(page.getByTestId('edit-panel')).toHaveCount(0);
    await chooseActivity(page, 'Off: straight lines');
    await expect.poll(() => savedTracks(page)).toBe(1);
}

// A routed segment is routed again with its own activity: routing in the menu is off, but a drag of the end still
// goes to the engine (a polyline without markup would not need it) and gives a route, not a straight line
async function expectRerouted(page: Page, engineLoadsBefore: number, network: { engineLoads: number }) {
    // a click on the line is caught from the drawn frame: right after the track loads, the frame can be missing
    await expect(async () => {
        await clickMap(page, START);
        await expect(page.getByTestId('edit-panel')).toBeVisible({ timeout: 1000 });
    }).toPass();
    await dragMap(page, FINISH, MOVED);
    await expect.poll(() => network.engineLoads).toBe(engineLoadsBefore + 1);
    await expect.poll(() => kilometers(page)).toBeGreaterThan(2);
}

test('Перезагрузка страницы', async ({ page, network }) => {
    await drawRouted(page);
    const length = await kilometers(page);
    await page.reload();
    await expect(await trackNames(page)).toHaveCount(1);
    expect(await kilometers(page)).toBe(length);
    await expect(page.getByRole('button', { name: 'Routing is off: lines are straight' })).toBeVisible();
    await expectRerouted(page, network.engineLoads, network);
});

test('Ссылка при сохранённом списке', async ({ page, network }) => {
    network.storage.set('narikalanarikalanarik1', NARIKALA);
    await page.goto(`./#m=12/41.7/44.8&nktk=${MTATSMINDA}`);
    await expect(await trackNames(page)).toHaveCount(1);
    await expect.poll(() => savedTracks(page)).toBe(1);
    // a new document, not a hash change: about:blank between the navigations
    await page.goto('about:blank');
    await page.goto('./#l=O&nktl=narikalanarikalanarik1');
    await expect(await trackNames(page)).toHaveCount(2);
    expect(
        await (await trackNames(page)).evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label'))),
    ).toEqual(['Actions for Mtatsminda', 'Actions for Narikala']);
    // without m= the map shows the full track from the link: a view near Narikala, not near Mtatsminda
    await expect.poll(() => new URL(page.url()).hash).toMatch(/m=\d+(\.\d+)?\/41\.68\d+\/44\.80\d+/);
});

// Database sessions, as SessionRepository of the old client (src/lib/session-state at commit 015be893): object store
// sessionData with keyPath sessionId and index mtime
function writeLegacySessions(page: Page, sessions: { sessionId: string; mtime: number; tracks: string }[]) {
    return page.evaluate(
        (records) =>
            new Promise<void>((resolve, reject) => {
                const request = indexedDB.open('sessions', 1);
                request.onupgradeneeded = () => {
                    const store = request.result.createObjectStore('sessionData', { keyPath: 'sessionId' });
                    store.createIndex('mtime', 'mtime', { unique: false });
                };
                request.onsuccess = () => {
                    const transaction = request.result.transaction('sessionData', 'readwrite');
                    for (const { sessionId, mtime, tracks } of records) {
                        transaction.objectStore('sessionData').put({ sessionId, mtime, data: { hash: '#', tracks } });
                    }
                    transaction.oncomplete = () => {
                        request.result.close();
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error);
                };
                request.onerror = () => reject(request.error);
            }),
        sessions,
    );
}

function legacySessionIds(page: Page) {
    return page.evaluate(
        () =>
            new Promise<unknown>((resolve, reject) => {
                const request = indexedDB.open('sessions');
                request.onsuccess = () => {
                    const keys = request.result.transaction('sessionData').objectStore('sessionData').getAllKeys();
                    keys.onsuccess = () => {
                        request.result.close();
                        resolve(keys.result);
                    };
                    keys.onerror = () => reject(keys.error);
                };
                request.onerror = () => reject(request.error);
            }),
    );
}

test('Сессия старого клиента', async ({ page }) => {
    // first visit without sessions: no own record appears (else the reload below does not import the session), and
    // the database sessions is not created (else writeLegacySessions finds version 1 without the object store and
    // does not finish)
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await writeLegacySessions(page, [{ sessionId: 'old', mtime: Date.now(), tracks: MTATSMINDA }]);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mtatsminda', exact: true })).toBeVisible();
    await expect(await trackNames(page)).toHaveCount(1);
    // the imported list is written as an own record: the next visit does not import the session a second time
    await expect.poll(() => savedTracks(page)).toBe(1);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Mtatsminda', exact: true })).toBeVisible();
    await expect(await trackNames(page)).toHaveCount(1);
    expect(await legacySessionIds(page)).toEqual(['old']);
});

test('Свой список уже есть', async ({ page }) => {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'New track' }).first().click();
    await clickMap(page, START);
    await clickMap(page, FINISH);
    await page.getByRole('button', { name: 'Finish editing' }).click();
    await expect.poll(() => savedTracks(page)).toBe(1);
    await writeLegacySessions(page, [{ sessionId: 'old', mtime: Date.now(), tracks: MTATSMINDA }]);
    await page.reload();
    await expect(await trackNames(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Mtatsminda', exact: true })).toHaveCount(0);
    expect(await legacySessionIds(page)).toEqual(['old']);
});

test('Несколько сессий старого клиента', async ({ page }) => {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await writeLegacySessions(page, [
        { sessionId: 'later', mtime: Date.now(), tracks: NARIKALA },
        { sessionId: 'earlier', mtime: Date.now() - 60_000, tracks: MTATSMINDA },
    ]);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Narikala', exact: true })).toBeVisible();
    await expect(await trackNames(page)).toHaveCount(1);
});

test('Открытие ссылки', async ({ page, context, browser, network }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await drawRouted(page);
    await openTracks(page);
    await page.getByRole('button', { name: 'Tracks menu' }).click();
    await page.getByRole('menuitem', { name: 'Copy link for all tracks' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    // a different user: own IndexedDB, the same track storage
    const other = await browser.newContext();
    try {
        await network.attach(other);
        const second = await other.newPage();
        await second.goto(link);
        await expect(await trackNames(second)).toHaveCount(1);
        await expect.poll(() => kilometers(second)).toBeGreaterThan(2);
        await expectRerouted(second, network.engineLoads, network);
    } finally {
        await other.close();
    }
});
