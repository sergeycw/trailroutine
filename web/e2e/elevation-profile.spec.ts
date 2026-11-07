import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { elevationAt, expect, mapPoint, openTracks, test } from './fixtures.ts';

// Elevation profile and GPX with elevations on the clone build: the elevation service is a stub of the fixture network
// (the elevation is a function of the latitude, elevationAt), the tests do not go to the network. The test titles are
// the scenarios of the specs tracks, track-files and route-editing (design add-web-elevation-profile).

// saveNktk({name: 'Mtatsminda', segments: [[41.69, 44.79 → 41.695, 44.786]], points: [TV tower 41.6945, 44.786]}):
// as a string, because e2e builds as a Node module (nodenext), and src/tracks/ imports without extensions
const TBILISI = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';
// the points are offsets from the map center (mapPoint in e2e/fixtures.ts)
const VIEW = './#m=15/41.69/44.785';
const START = { dx: -100, dy: 60 };
const FINISH = { dx: 100, dy: 40 };

const panel = (page: Page) => page.getByTestId('elevation-profile');
const stat = (page: Page, key: string) => panel(page).locator(`[data-stat="${key}"]`);

async function trackMenu(page: Page, name: string, item: string) {
    await openTracks(page);
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
}

test('Профиль трека', async ({ page, network }) => {
    await page.goto(`./#m=15/41.692/44.788&nktk=${TBILISI}`);
    await trackMenu(page, 'Mtatsminda', 'Show elevation profile');
    await expect(stat(page, 'distance')).toHaveText(/^0\.\d\d km$/);
    expect(network.elevationRequests).toHaveLength(1);
    // stub elevations: 41.69 → 900 m, 41.695 → 950 m
    await expect(stat(page, 'start')).toHaveText(`${Math.round(elevationAt(41.69))} m`);
    await expect(stat(page, 'finish')).toHaveText(`${Math.round(elevationAt(41.695))} m`);
    await expect(panel(page).getByRole('link', { name: /viewfinderpanoramas/ })).toBeVisible();
    // «Курсор на графике»: a marker on the map
    const graph = await page.getByTestId('profile-graph').boundingBox();
    if (!graph) {
        throw new Error('нет графика');
    }
    await page.mouse.move(graph.x + graph.width / 2, graph.y + 30);
    await expect(page.getByTestId('profile-marker')).toBeVisible();
    await expect(page.getByTestId('profile-cursor-label')).toContainText('925 m');
});

test('Профиль отрезка', async ({ page, network }) => {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'New track' }).first().click();
    for (const offset of [START, FINISH]) {
        const point = await mapPoint(page, offset);
        await page.mouse.move(point.x, point.y);
        await page.mouse.click(point.x, point.y);
    }
    await page.keyboard.press('Escape');
    // the waypoint menu works from the store, without a drawn frame
    const finish = await mapPoint(page, FINISH);
    await page.mouse.move(finish.x, finish.y);
    await page.mouse.click(finish.x, finish.y, { button: 'right' });
    await page.getByTestId('map-menu').getByRole('menuitem', { name: 'Show elevation profile for segment' }).click();
    await expect(stat(page, 'distance')).toHaveText(/ km$/);
    expect(network.elevationRequests).toHaveLength(1);
    // the editing continues
    await expect(page.getByTestId('edit-panel')).toBeVisible();
});

test('Сохранить с высотами', async ({ page, network }) => {
    await page.goto(`./#m=12/41.7/44.8&nktk=${TBILISI}`);
    const download = page.waitForEvent('download');
    // «Save as GPX» is always with elevations (design trim-track-menus)
    await trackMenu(page, 'Mtatsminda', 'Save as GPX');
    const file = await download;
    expect(file.suggestedFilename()).toBe('Mtatsminda.gpx');
    const content = readFileSync(await file.path(), 'utf8');
    expect(network.elevationRequests).toHaveLength(1);
    expect(network.elevationRequests[0].split('\n')).toHaveLength(3);
    // the track point and both points of the segment have the <ele> of the stub
    expect(content.match(/<ele>\d+\.\d<\/ele>/g)).toHaveLength(3);
    expect(content).toMatch(/<trkpt lat="41\.69\d{4}" lon="44\.7[89]\d{4}"><ele>9\d\d\.\d<\/ele><time>/);
});
