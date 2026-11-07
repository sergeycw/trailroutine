import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';

const TERRARIUM = /elevation-tiles-prod\/terrarium\//;

// A Terrarium slope: the elevation grows by 2 m per tile pixel from left to right, 1000…1510 m (the encoding is from
// the Terrain Tiles README: elevation = R * 256 + G + B / 256 - 32768). PNG is lossless, so the library decodes exactly
// these elevations
async function slopeTile(): Promise<string> {
    const size = 256;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const value = 32768 + 1000 + x * 2;
            const i = (y * size + x) * 4;
            image.data.set([value >> 8, value & 255, 0, 255], i);
        }
    }
    context.putImageData(image, 0, 0);
    return URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }));
}

describe('Горизонтали', () => {
    let tiles: FixtureTiles;

    beforeEach(async () => {
        tiles = fixtureTiles();
        // renderApp sets the protocol with this fixture
        tiles.respond(TERRARIUM, await slopeTile());
    });

    afterEach(async () => {
        await cleanup();
    });

    test('Горизонтали из рельефа', async () => {
        // m=14 is MapLibre zoom 13: the step is 20 m, the main lines every 100 m
        const { map } = await renderApp(tiles, '#m=14/42.66/44.64&l=O/Ct', { tracksOpen: false });
        await expect
            .poll(() => map.queryRenderedFeatures({ layers: ['Ct'] }).length, { timeout: 10_000 })
            .toBeGreaterThan(0);
        const lines = map.queryRenderedFeatures({ layers: ['Ct'] });
        const heights = new Set(lines.map((feature) => feature.properties.ele as number));
        for (const ele of heights) {
            expect(ele % 20, String(ele)).toBe(0);
        }
        expect(heights).toContain(1020);
        for (const feature of lines) {
            expect(feature.properties.level, String(feature.properties.ele)).toBe(
                feature.properties.ele % 100 === 0 ? 1 : 0,
            );
        }
        // the labels are only on the main lines
        await expect.poll(() => map.queryRenderedFeatures({ layers: ['Ct-labels'] }).length).toBeGreaterThan(0);
        for (const label of map.queryRenderedFeatures({ layers: ['Ct-labels'] })) {
            expect(label.properties.ele % 100).toBe(0);
        }
        // the relief is Terrain Tiles tiles of the same zoom as the contour tile, through the fixture; nothing went to
        // the network
        expect(
            tiles.requested.filter((url) => TERRARIUM.test(url)).every((url) => url.includes('/terrarium/13/')),
        ).toBe(true);
        expect(tiles.requested.some((url) => TERRARIUM.test(url))).toBe(true);
        expect(tiles.external).toEqual([]);
        await expect.element(page.getByRole('link', { name: 'Terrain: Mapzen, sources' })).toBeVisible();
    });

    test('Горизонтали на мелком зуме', async () => {
        const { map } = await renderApp(tiles, '#m=10/42.66/44.64&l=O/Ct', { tracksOpen: false });
        await expect.poll(() => map.areTilesLoaded()).toBe(true);
        expect(tiles.requested.some((url) => url.includes('tile.openstreetmap.org'))).toBe(true);
        expect(tiles.requested.filter((url) => TERRARIUM.test(url))).toEqual([]);
        expect(map.queryRenderedFeatures({ layers: ['Ct'] })).toEqual([]);
        expect(tiles.external).toEqual([]);

        // the border: from m=11 the contour lines are already present, the step is 200 m
        await cleanup();
        const zoom11 = await renderApp(tiles, '#m=11/42.66/44.64&l=O/Ct', { tracksOpen: false });
        await expect
            .poll(() => zoom11.map.queryRenderedFeatures({ layers: ['Ct'] }).length, { timeout: 10_000 })
            .toBeGreaterThan(0);
        for (const feature of zoom11.map.queryRenderedFeatures({ layers: ['Ct'] })) {
            expect(feature.properties.ele % 200).toBe(0);
        }
    });
});
