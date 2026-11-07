import type { Point } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { fakeRouter } from '@/test/fake-router';
import { click, features, P, pressEscape } from '@/test/map-events';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { distance } from './geometry';
import { parseNktkSequence } from './nktk';
import { TRACK_TICKS } from './style';

// Distance ticks and the ruler in App (spec tracks, «Отметки расстояния», «Линейка»). Routing is off: lines are
// straight, and lengths come from the waypoints.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

const VIEW = '#m=14/41.69/44.785&l=O';
const A = P(41.685, 44.765);
// 2.3 km to the east of A along the parallel
const B = P(41.685, 44.765 + 2300 / distance(A, P(41.685, 45.765)));

const tickLabels = (map: MaplibreMap) =>
    features<Point>(map, TRACK_TICKS).map((feature) => feature.properties?.label as string);

async function trackMenu(name: string, item: string) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitemcheckbox', { name: item }).click();
}

async function drawTrack(map: MaplibreMap, points: { lat: number; lng: number }[]) {
    await page.getByRole('button', { name: 'New track' }).first().click();
    for (const point of points) {
        await click(map, point);
    }
    pressEscape();
}

describe('Отметки расстояния', () => {
    test('Отметки на отрезке', async () => {
        const { map } = await renderApp(tiles, VIEW, { router: fakeRouter({ auto: true }) });
        await drawTrack(map, [A, B]);
        expect(tickLabels(map)).toEqual([]);
        await trackMenu('New track', 'Show distance marks');
        // z14 MapLibre at latitude 41.7: 15 mm ≈ 170 m, so the step is 0.5 km
        await expect.poll(() => tickLabels(map)).toEqual(['0.5 km', '1 km', '1.5 km', '2 km', '0 km', '2.3 km']);
        await trackMenu('New track', 'Show distance marks');
        await expect.poll(() => tickLabels(map)).toEqual([]);
    });

    test('Зум меняет шаг', async () => {
        const { map } = await renderApp(tiles, VIEW, { router: fakeRouter({ auto: true }) });
        await drawTrack(map, [A, B]);
        await trackMenu('New track', 'Show distance marks');
        await expect.poll(() => tickLabels(map)).toHaveLength(6);
        // z11: 15 mm ≈ 1.6 km, so the step is 2 km, and the 2 km tick is nearer than 0.8 km to the end and goes away
        map.jumpTo({ zoom: 11 });
        await expect.poll(() => tickLabels(map)).toEqual(['0 km', '2.3 km']);
    });

    test('Отметки в ссылке', async () => {
        const stored: string[] = [];
        const fetchFn: typeof fetch = async (_input, init) => {
            stored.push(String(init?.body));
            return new Response('', { status: 200 });
        };
        const { map } = await renderApp(tiles, VIEW, {
            router: fakeRouter({ auto: true }),
            fetch: fetchFn,
            writeClipboard: async (text) => {
                await text;
            },
        });
        await drawTrack(map, [A, B]);
        await trackMenu('New track', 'Show distance marks');
        await page.getByRole('button', { name: 'Actions for New track' }).click();
        await page.getByRole('menuitem', { name: 'Copy link for track', exact: true }).click();
        await expect.poll(() => stored).toHaveLength(1);
        expect(parseNktkSequence(stored[0])[0].measureTicksShown).toBe(true);
    });

    test('отметки видны во время правки отрезка', async () => {
        const { map } = await renderApp(tiles, VIEW, { router: fakeRouter({ auto: true }) });
        await page.getByRole('button', { name: 'Measure distance' }).click();
        await click(map, A);
        await click(map, B);
        // drawing still goes on
        await expect.poll(() => tickLabels(map)).toContain('2.3 km');
    });
});

describe('Линейка', () => {
    test('Измерить расстояние', async () => {
        const { map } = await renderApp(tiles, VIEW, { router: fakeRouter({ auto: true }) });
        const end = P(41.685, 44.765 + 1200 / distance(A, P(41.685, 45.765)));
        await page.getByRole('button', { name: 'Measure distance' }).click();
        await click(map, A);
        await click(map, end);
        pressEscape();
        const row = page.getByRole('listitem').filter({ hasText: 'Ruler' });
        await expect.element(row.getByTestId('track-length')).toHaveTextContent('1.20 km');
        await expect.poll(() => tickLabels(map)).toEqual(['0.5 km', '1 km', '0 km', '1.2 km']);
    });
});
