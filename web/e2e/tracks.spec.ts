import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHash } from '../src/state/hash.ts';
import { copiedLink, expect, openTracks, test } from './fixtures.ts';

// The test titles are the scenarios of the specs tracks and track-files (openspec/specs/tracks,
// openspec/specs/track-files). The track storage and the proxy are in memory (e2e/fixtures.ts), the tests do not go to
// the network.

const fixture = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const OLD_LINKS = readFileSync(fixture('state/fixtures/old-links.txt'), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('http'));

function paramOf(name: string) {
    const link = OLD_LINKS.find((item) => parseHash(item).has(name));
    const value = link && parseHash(link).get(name)?.[0];
    if (!value) {
        throw new Error(`нет ссылки с ${name} в old-links.txt`);
    }
    return value;
}

// saveNktk({name: 'Mtatsminda', segments: [[41.69, 44.79 → 41.695, 44.786]], points: [TV tower 41.6945, 44.786]}):
// as a string, because e2e builds as a Node module (nodenext), and src/tracks/ imports without extensions
const TBILISI = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';

async function track(page: import('@playwright/test').Page, name: string) {
    await openTracks(page);
    return page.getByRole('list', { name: 'Tracks' }).getByRole('button', { name, exact: true });
}

test('Ссылка на хранилище', async ({ page, network }) => {
    const key = paramOf('nktl');
    network.storage.set(key, TBILISI);
    await page.goto(`./#l=O&nktl=${key}`);
    await expect(await track(page, 'Mtatsminda')).toBeVisible();
    await expect.poll(() => new URL(page.url()).hash).not.toContain('nktl');
    // without m= in the address the map shows the full track: a view near Tbilisi
    await expect.poll(() => new URL(page.url()).hash).toMatch(/^#l=O&m=\d+(\.\d+)?\/41\.69\d+\/44\.78\d+$/);
});

test('Трек в адресе', async ({ page, network }) => {
    await page.goto(`./#m=8/50/30&nktk=${paramOf('nktk')}`);
    await expect(await track(page, 'Hello')).toBeVisible();
    expect(new URL(page.url()).hash).not.toContain('nktk');
    expect(network.external).toEqual([]);
});

test('Точка в адресе', async ({ page }) => {
    await page.goto('./#m=12/41.7/44.8&nktp=41.7/44.8/Tbilisi');
    await expect(await track(page, 'Tbilisi')).toBeVisible();
});

test('Неизвестный ключ', async ({ page }) => {
    await page.goto('./#m=12/41.7/44.8&nktl=unknownunknownunknown1');
    await expect(
        page.getByText('Could not download file from url "Track from nakarte server", no data could be loaded'),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tracks' })).toHaveCount(0);
});

test('Ссылка готова', async ({ page, context, browser, browserName, network }) => {
    // only Chromium has the clipboard permissions (copiedLink in e2e/fixtures.ts)
    if (browserName === 'chromium') {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    }
    await page.goto(`./#m=12/41.7/44.8&l=O&nktk=${TBILISI}`);
    await expect(await track(page, 'Mtatsminda')).toBeVisible();
    await openTracks(page);
    await page.getByRole('button', { name: 'Tracks menu' }).click();
    await page.getByRole('menuitem', { name: 'Copy link for all tracks' }).click();
    await expect(page.getByText('Link copied')).toBeVisible();
    const link = await copiedLink(page, network);
    expect(new URL(link).hash).toMatch(/nktl=[\w-]{22}$/);
    // the link opens the same tracks for a different user; a tab of the same browser would add them to the
    // autosaved ones (spec tracks, «Треки из адреса дополняют сохранённые»)
    const other = await browser.newContext();
    try {
        await network.attach(other);
        const second = await other.newPage();
        await second.goto(link);
        await expect(await track(second, 'Mtatsminda')).toBeVisible();
    } finally {
        await other.close();
    }
});

test('Трек OSM', async ({ page, network }) => {
    // the OSM answer was recorded on 2026-10-08 (src/tracks/fixtures/README.md); the import uses the clone proxy
    network.proxyResponds('https://www.openstreetmap.org/trace/3376100/data', {
        path: fixture('tracks/fixtures/services/osm-3376100.gpx'),
    });
    await page.goto('./#m=12/41.7/44.8');
    // the link goes into the search box, Enter selects the track (design search-track-links)
    const search = page.getByRole('combobox', { name: 'Search' });
    await search.fill('https://www.openstreetmap.org/user/Wladich/traces/3376100');
    await expect(page.getByRole('option', { name: 'OSM track 3376100' })).toBeVisible();
    await search.press('Enter');
    await expect(await track(page, 'Test - Тест - Zkouška')).toBeVisible();
});

test('Открыть GPX', async ({ page }) => {
    await page.goto('./#m=12/41.7/44.8');
    await page
        .getByTestId('track-file-input')
        .setInputFiles(fixture('tracks/fixtures/files/track_service_prototype_full.gpx'));
    await expect(await track(page, 'track_service_prototype_full.gpx')).toBeVisible();
});

test('Сохранить в GPX', async ({ page }) => {
    await page.goto(`./#m=12/41.7/44.8&nktk=${TBILISI}`);
    await openTracks(page);
    await page.getByRole('button', { name: 'Actions for Mtatsminda' }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Save as GPX', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('Mtatsminda.gpx');
    const content = readFileSync(await file.path(), 'utf8');
    expect(content).toContain('<name>TV tower</name>');
    // the coordinates are on the nktk grid (≈ 2.4 m), six digits
    expect(content).toMatch(/<trkpt lat="41\.69\d{4}" lon="44\.7[89]\d{4}">/);
});
