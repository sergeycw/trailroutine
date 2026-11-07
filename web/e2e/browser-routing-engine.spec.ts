import { expect, test } from './fixtures.ts';

// The test titles are the scenarios of the spec browser-routing-engine (openspec/specs/browser-routing-engine/spec.md).
// e2e does not start the real engine: the CheerpJ runtime is on a CDN, and the tests do not go to the network.

test('Прокладка выключена', async ({ page, network }) => {
    const engineRequests: string[] = [];
    page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.hostname.endsWith('leaningtech.com') || /^\/(brouter-wasm|tiles)\//.test(url.pathname)) {
            engineRequests.push(request.url());
        }
    });
    await page.goto('./');
    await expect(page.locator('.maplibregl-canvas')).toBeVisible();
    await expect.poll(() => network.tilesOf('Of').length).toBeGreaterThan(0);
    expect(engineRequests).toEqual([]);
    expect(page.workers().map((worker) => worker.url())).not.toContainEqual(expect.stringContaining('engine.worker'));
});
