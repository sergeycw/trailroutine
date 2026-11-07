import { expect, test } from './fixtures.ts';

// Street View in the built clone (spec street-view). The Maps JavaScript API is a stub of the fixture network
// (FAKE_GOOGLE_MAPS), the coverage tiles are a fixture; any other request to Google fails the test. The map center
// (640, 360) is the panorama STREET_VIEW_PANORAMAS[0].
const VIEW = './#m=15/41.693/44.78&l=O';
const CENTER = { x: 640, y: 360 };

test('Режим без панорамы', async ({ page, network }) => {
    await page.goto(VIEW);
    await page.getByRole('button', { name: 'Street View', exact: true }).click();
    await expect.poll(() => network.tilesOf('street-view-coverage').length).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('n2=_g');
    expect(network.googleApiLoads).toEqual([]);
});

test('Панорама найдена', async ({ page, network }) => {
    await page.goto(VIEW);
    await page.getByRole('button', { name: 'Street View', exact: true }).click();
    await page.mouse.move(CENTER.x, CENTER.y);
    await page.mouse.click(CENTER.x, CENTER.y);
    const panorama = page.getByTestId('google-panorama');
    await expect(panorama).toHaveAttribute('data-view', '41.69300,44.78000,0');
    await expect(page.getByTestId('panorama-marker')).toBeVisible();
    // the deploy builds with the key from the secret GOOGLE_MAPS_API_KEY and runs e2e on this same build: the test
    // takes the key from the load URL, and expects the rules of the mode without a key only when the key is empty
    expect(network.googleApiLoads).toHaveLength(1);
    const api = new URL(network.googleApiLoads[0]);
    expect(`${api.origin}${api.pathname}`).toBe('https://maps.googleapis.com/maps/api/js');
    expect(api.searchParams.get('callback')).toBe('__trailroutineGoogleMapsReady');
    await expect(page.locator('.google-street-view-keyless')).toHaveCount(api.searchParams.get('key') ? 0 : 1);
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('n2=_g/g/41.693000/44.780000/0.0/0.0/1.0');
    // the view direction in the window turns the marker on the map
    await page.evaluate(() => {
        (window as unknown as { __panorama: { setPov(pov: object): void } }).__panorama.setPov({
            heading: 90,
            pitch: 0,
        });
    });
    await expect(page.getByTestId('panorama-marker')).toHaveAttribute('data-heading', '90');
});

test('Старая ссылка n=', async ({ page, network }) => {
    await page.goto(`${VIEW}&n=41.693500/44.781000/45.0/0.0/1.0`);
    await expect(page.getByTestId('google-panorama')).toHaveAttribute('data-view', '41.69350,44.78100,45');
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('n2=_g/g/41.693500/44.781000/45.0/0.0/1.0');
    expect(await page.evaluate(() => location.hash)).not.toMatch(/[#&]n=/u);
    expect(network.googleApiLoads).toHaveLength(1);
});

test('Удалённый провайдер', async ({ page, network }) => {
    await page.goto(`${VIEW}&n2=wmc`);
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Street View', exact: true })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    expect(network.tilesOf('street-view-coverage')).toEqual([]);
});
