import type { Point } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { fakeRouter } from '@/test/fake-router';
import {
    chooseFromMenu,
    click,
    editPanel,
    features,
    menuItems,
    near,
    newTrack,
    P,
    pressEscape,
    rightClick,
    waypoints,
} from '@/test/map-events';
import { memoryAutosave } from '@/test/memory-autosave';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { saveNktk } from './nktk';
import { TRACK_POINTS } from './style';

// Track points in App on a real MapLibre map (spec tracks, «Добавление точек трека», «Меню точки трека»):
// clicks are synthetic events on the canvas by map.project, the clipboard is the writeClipboard prop.
// Test names are spec scenarios.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

// the basemap is raster OpenStreetMap: it does not matter to the test, and the default vector basemap (OpenFreeMap)
// with the fixture (a real z12 tile) is drawn in all tiles of the screen and did not fit in the timeouts under the
// total load of the browser tests (change openfreemap-default-basemap)
const VIEW = '#m=15/41.69/44.785&l=O';
const SPOT = P(41.6912345, 44.7812345);
const ELSEWHERE = P(41.688, 44.789);
const FAR = P(41.692, 44.776);

async function render(hash: string, options: Parameters<typeof renderApp>[2] = {}) {
    return renderApp(tiles, `${VIEW}${hash}`, { router: fakeRouter({ auto: true }), ...options });
}

const points = (map: MaplibreMap) =>
    features<Point>(map, TRACK_POINTS).map((f) => ({
        name: f.properties?.name as string,
        at: P(f.geometry.coordinates[1], f.geometry.coordinates[0]),
    }));
const names = (map: MaplibreMap) => points(map).map((point) => point.name);

const nameField = () => page.getByRole('textbox', { name: 'Point name' });

async function trackMenu(name: string, item: string) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
}

// type a name in the new point window and confirm it
async function confirmName(map: MaplibreMap, name: string) {
    await expect.element(nameField()).toBeVisible();
    await nameField().fill(name);
    await page.getByRole('button', { name: 'Ok' }).click();
    await expect.element(nameField()).not.toBeInTheDocument();
    await expect.poll(() => names(map)).toContain(name);
}

const pointLink = `&nktp=${SPOT.lat}/${SPOT.lng}/Spring`;

describe('Добавление точек трека', () => {
    test('Поставить две точки', async () => {
        const { map } = await render(pointLink);
        await expect.poll(() => names(map)).toEqual(['Spring']);
        await trackMenu('Spring', 'Add point');
        await expect.element(page.getByTestId('point-panel')).toBeVisible();
        await click(map, ELSEWHERE);
        await expect.element(nameField()).toHaveValue('001');
        await page.getByRole('button', { name: 'Ok' }).click();
        await click(map, FAR);
        await expect.element(nameField()).toHaveValue('002');
        await page.getByRole('button', { name: 'Ok' }).click();
        await expect.poll(() => names(map)).toEqual(['Spring', '001', '002']);
        expect(near(points(map)[1].at, ELSEWHERE) && near(points(map)[2].at, FAR)).toBe(true);
        pressEscape();
        await expect.element(page.getByTestId('point-panel')).not.toBeInTheDocument();
        await click(map, P(41.689, 44.786));
        expect(names(map)).toHaveLength(3);
    });

    test('Своё название', async () => {
        const { map } = await render(pointLink);
        await trackMenu('Spring', 'Add point');
        await click(map, ELSEWHERE);
        await confirmName(map, 'Camp');
        await expect.poll(() => names(map)).toEqual(['Spring', 'Camp']);
    });

    test('Номер после наибольшего', async () => {
        const track = saveNktk({
            name: 'Walk',
            segments: [],
            points: [
                { ...ELSEWHERE, name: '003' },
                { ...FAR, name: 'Spring' },
            ],
        });
        const { map } = await render(`&nktk=${track}`);
        await trackMenu('Walk', 'Add point');
        await click(map, SPOT);
        await expect.element(nameField()).toHaveValue('004');
    });

    test('постановка заканчивает редактирование линии и делает скрытый трек видимым', async () => {
        const { map } = await render(pointLink);
        await newTrack(map, [ELSEWHERE, FAR]);
        await expect.element(editPanel()).toBeVisible();
        await page.getByRole('checkbox', { name: 'Show Spring' }).click();
        await trackMenu('Spring', 'Add point');
        await expect.element(editPanel()).not.toBeInTheDocument();
        await expect.element(page.getByRole('checkbox', { name: 'Show Spring' })).toBeChecked();
        await page.getByRole('button', { name: 'Done' }).click();
        await expect.element(page.getByTestId('point-panel')).not.toBeInTheDocument();
    });
});

describe('Меню точки трека', () => {
    test('меню по клику: название и пункты', async () => {
        const { map } = await render(pointLink);
        await click(map, SPOT);
        expect(await menuItems()).toEqual(['Rename', 'Move', 'Copy coordinates', 'Delete']);
        await expect.element(page.getByTestId('map-menu').getByText('Spring', { exact: true })).toBeVisible();
    });

    test('правый клик тоже открывает меню', async () => {
        const { map } = await render(pointLink);
        await rightClick(map, SPOT);
        expect(await menuItems()).toContain('Copy coordinates');
    });

    test('Переименовать точку', async () => {
        const { map } = await render(pointLink);
        await click(map, SPOT);
        await chooseFromMenu('Rename');
        await expect.element(nameField()).toHaveValue('Spring');
        await nameField().fill('Pass');
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => names(map)).toEqual(['Pass']);
    });

    test('Переместить точку', async () => {
        const { map } = await render(pointLink);
        await click(map, SPOT);
        await chooseFromMenu('Move');
        await expect.element(page.getByText('Click map to move Spring')).toBeVisible();
        await click(map, ELSEWHERE);
        await expect.poll(() => near(points(map)[0].at, ELSEWHERE)).toBe(true);
        await expect.element(page.getByTestId('point-panel')).not.toBeInTheDocument();
    });

    test('перенос отменяется Escape', async () => {
        const { map } = await render(pointLink);
        await click(map, SPOT);
        await chooseFromMenu('Move');
        pressEscape();
        await expect.element(page.getByTestId('point-panel')).not.toBeInTheDocument();
        await click(map, ELSEWHERE);
        expect(near(points(map)[0].at, SPOT)).toBe(true);
    });

    test('Скопировать координаты', async () => {
        const copied: string[] = [];
        const { map } = await render(pointLink, {
            writeClipboard: async (text) => {
                copied.push(await text);
            },
        });
        await click(map, SPOT);
        await chooseFromMenu('Copy coordinates');
        await expect.poll(() => copied).toEqual(['41.69123 44.78123']);
        await expect.element(page.getByText('Coordinates copied')).toBeVisible();
    });

    test('Удалить точку', async () => {
        const autosave = memoryAutosave();
        const track = saveNktk({
            name: 'Walk',
            segments: [],
            points: [
                { ...SPOT, name: 'Spring' },
                { ...FAR, name: 'Camp' },
            ],
        });
        const { map } = await render(`&nktk=${track}`, { autosave });
        await click(map, SPOT);
        await chooseFromMenu('Delete');
        await expect.poll(() => names(map)).toEqual(['Camp']);
        await cleanup();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const reloaded = await render('', { autosave });
        await expect.poll(() => names(reloaded.map)).toEqual(['Camp']);
    });

    test('при рисовании клик по точке трека ставит опорную точку', async () => {
        const { map } = await render(pointLink);
        await newTrack(map, [ELSEWHERE, SPOT]);
        expect(waypoints(map)).toHaveLength(2);
        await expect.element(page.getByTestId('map-menu')).not.toBeInTheDocument();
    });
});
