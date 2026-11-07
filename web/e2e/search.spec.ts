import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// Search, placemark and ruler in the built clone (specs map-search and tracks). The search providers answer with the
// saved answers of the fixture network (mapy.cz through the clone proxy, photon), the test does not go to the network.
// Window Desktop Chrome 1280×720, map center (640, 360).
const VIEW = './#m=15/41.69/44.785&l=O';

async function clickMap(page: Page, point: { x: number; y: number }) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y);
}

test('Ответ mapy.cz', async ({ page, network }) => {
    await page.goto(VIEW);
    await page.getByRole('combobox', { name: 'Search' }).fill('mtatsminda');
    await expect(page.getByRole('option')).toHaveCount(5);
    await expect(page.getByRole('link', { name: 'Mapy.com' })).toBeVisible();
    expect(network.searchRequests).toHaveLength(1);
    expect(network.searchRequests[0]).toContain('/https/pro.mapy.cz/suggest/?phrase=mtatsminda');
    await page.getByRole('option').first().click();
    await expect(page.getByTestId('placemark')).toContainText('Mtatsminda Park');
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('&r=41.693040/44.779477/Mtatsminda%20Park');
});

test('mapy.cz недоступен', async ({ page, network }) => {
    network.searchResponds('mapycz', { status: 502 });
    await page.goto(VIEW);
    await page.getByRole('combobox', { name: 'Search' }).fill('mtatsminda');
    await expect(page.getByRole('option')).toHaveCount(5);
    await expect(page.getByRole('link', { name: 'Photon by Komoot' })).toBeVisible();
    expect(network.searchRequests.map((url) => new URL(url).hostname)).toEqual([
        'nakarte-cors-proxy.nakarte-routing.workers.dev',
        'photon.komoot.io',
    ]);
});

test('Ссылка с меткой', async ({ page }) => {
    await page.goto(`${VIEW}&r=41.693040/44.779477/Mtatsminda%20Park`);
    await expect(page.getByTestId('placemark')).toContainText('Mtatsminda Park');
    // the placemark stays after a reload: it is in the address
    await page.reload();
    await expect(page.getByTestId('placemark')).toContainText('Mtatsminda Park');
});

test('Измерить расстояние', async ({ page }) => {
    await page.goto(VIEW);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Measure distance' }).click();
    // ≈ 3.56 m per pixel at z15 near Tbilisi: 340 px ≈ 1.2 km
    await clickMap(page, { x: 470, y: 400 });
    await clickMap(page, { x: 810, y: 400 });
    // while the line is drawn, the length is in the editor of the top bar
    await expect(page.getByTestId('edit-panel').getByRole('textbox', { name: 'Track name' })).toHaveValue('Ruler');
    await expect(page.getByTestId('edit-length')).toHaveText(/^1\.2\d km$/u);
    await page.getByRole('button', { name: 'Finish editing' }).click();
    await expect(page.getByTestId('edit-panel')).toHaveCount(0);
});
