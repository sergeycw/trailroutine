import type { Page } from '@playwright/test';
import { expect, openTracks, TRACKS_STORAGE, test } from './fixtures.ts';

// The move from the old address to trailroutine.com (change move-to-trailroutine-domain, spec clone-hosting).
// Both host names are routed to vite preview (network.serveSite), so each is its own origin with its own storage,
// as in production. Test names are the scenarios of the spec.

const OLD = 'https://nakarte-routing.pages.dev';
const NEW = 'https://trailroutine.com';
// the format of web/src/layers/settings.ts; the base layer O (OSM) is not the default Of, so it shows the move
const LAYERS = JSON.stringify({
    version: 1,
    groupDefaults: true,
    listed: {},
    custom: [],
    selection: { base: 'O', overlays: [] },
    quickLayers: {},
});

test.use({ tracksOpen: false });

// The autosave record and a setting on the old origin, written from an empty page of that origin. The record has the
// form of web/src/autosave/saved.ts (version 1, lines as Float64Array).
async function seedOldAddress(page: Page) {
    await page.goto(`${OLD}/__seed__`);
    await page.evaluate(async (layers) => {
        localStorage.setItem('nakarte-web:layers', layers);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('nakarte-web', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('autosave');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const transaction = db.transaction('autosave', 'readwrite');
        transaction.objectStore('autosave').put(
            {
                version: 1,
                tracks: [
                    {
                        name: 'Kazbegi loop',
                        color: 3,
                        visible: true,
                        measureTicksShown: false,
                        segments: [new Float64Array([42.657, 44.6431, 42.66, 44.65, 42.67, 44.66])],
                        points: [],
                        routes: [null],
                    },
                ],
            },
            'tracks',
        );
        await new Promise((resolve) => {
            transaction.oncomplete = resolve;
        });
        db.close();
    }, LAYERS);
}

// the address the browser opened on the new domain, before the app removes `move` from it
function arrival(page: Page) {
    return page.waitForEvent('framenavigated', (frame) => frame === page.mainFrame() && frame.url().startsWith(NEW));
}

test.describe('Move from the old address', () => {
    test('Old address with saved tracks', async ({ page, network }) => {
        network.serveSite('nakarte-routing.pages.dev', 'trailroutine.com');
        await seedOldAddress(page);
        const arrived = arrival(page);
        await page.goto(`${OLD}/#m=12/41.7/44.8`);
        expect((await arrived).url()).toMatch(
            /^https:\/\/trailroutine\.com\/#m=12\/41\.7\/44\.8&move=[\w-]{22}\.[\w-]{43}$/,
        );
        await openTracks(page);
        await expect(page.getByText('Kazbegi loop')).toBeVisible();
        expect(page.url()).not.toContain('move=');
        const layers = await page.evaluate(() => localStorage.getItem('nakarte-web:layers'));
        expect(JSON.parse(layers ?? '{}').selection).toEqual({ base: 'O', overlays: [] });
        // one upload: the server keeps ciphertext, not the track
        expect(network.storage.size).toBe(1);
        expect([...network.storage.values()][0]).not.toContain('Kazbegi');
    });

    test('Second visit to the old address', async ({ page, network }) => {
        network.serveSite('nakarte-routing.pages.dev', 'trailroutine.com');
        await seedOldAddress(page);
        await page.goto(`${OLD}/#m=12/41.7/44.8`);
        await page.waitForURL(/^https:\/\/trailroutine\.com\//);
        await openTracks(page);
        await expect(page.getByText('Kazbegi loop')).toBeVisible();
        const arrived = arrival(page);
        await page.goto(`${OLD}/#m=12/41.7/44.8`);
        await arrived;
        await openTracks(page);
        await expect(page.getByText('Kazbegi loop')).toHaveCount(1);
        expect(network.storage.size).toBe(1);
    });

    test('Old address without saved data', async ({ page, network }) => {
        network.serveSite('nakarte-routing.pages.dev', 'trailroutine.com');
        const arrived = arrival(page);
        await page.goto(`${OLD}/#m=12/41.7/44.8&q=kazbegi`);
        expect((await arrived).url()).toBe(`${NEW}/#m=12/41.7/44.8&q=kazbegi`);
        expect(network.storage.size).toBe(0);
    });

    test('Track storage fails', async ({ page, context, network }) => {
        network.serveSite('nakarte-routing.pages.dev', 'trailroutine.com');
        await seedOldAddress(page);
        // the route registered last wins over the fixture: the track storage refuses the upload
        await context.route(`${TRACKS_STORAGE}/track/**`, (route) =>
            route.fulfill({ status: 500, body: 'error', headers: { 'Access-Control-Allow-Origin': OLD } }),
        );
        await page.goto(`${OLD}/#m=12/41.7/44.8`);
        await openTracks(page);
        await expect(page.getByText('Kazbegi loop')).toBeVisible();
        expect(new URL(page.url()).origin).toBe(OLD);
    });
});
