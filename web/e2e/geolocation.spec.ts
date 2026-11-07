import { expect, test } from './fixtures.ts';

// Geolocation in the built clone with the real Chromium Geolocation API (spec web-client, «Где я»): Playwright gives
// the permission and the position of the context. MapLibre copies the error of the real browser into the event field by
// field (for…in over GeolocationPositionError): the test checks that the error code gets to the toast.
const VIEW = './#m=10/41/44&l=O';

test('Положение получено', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 41.7, longitude: 44.8, accuracy: 30 });
    await page.goto(VIEW);
    await page.getByRole('button', { name: 'Find my location' }).click();
    await expect(page.locator('.maplibregl-user-location-dot')).toBeVisible();
    await expect.poll(() => page.evaluate(() => location.hash), { timeout: 10_000 }).toContain('/41.70000/44.80000');
    expect(await page.evaluate(() => localStorage.getItem('nakarte-web:position'))).toBe('{"lat":41.7,"lng":44.8}');
});

test('Геолокация запрещена', async ({ page, context }) => {
    // without a permission the state is prompt, the button is active; headless Chromium denies the request (code 1)
    await context.clearPermissions();
    await page.goto(VIEW);
    await page.getByRole('button', { name: 'Find my location' }).click();
    await expect(
        page.getByText('Geolocation is blocked for this site. Please, enable in browser setting.'),
    ).toBeVisible();
});
