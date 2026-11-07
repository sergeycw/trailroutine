import type { LineString } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { bend, type FakeRouter, fakeRouter } from '@/test/fake-router';
import {
    chooseFromMenu,
    click,
    drag,
    editPanel,
    features,
    fire,
    idle,
    key,
    legs,
    longPress,
    mapMenu,
    menuItems,
    near,
    newTrack,
    P,
    pressEscape,
    rightClick,
    tap,
    waypoints,
} from '@/test/map-events';
import { memoryAutosave } from '@/test/memory-autosave';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import type { LatLng } from '@/tracks/model';
import { saveNktk } from '@/tracks/nktk';
import { TRACK_LINES } from '@/tracks/style';
import { EDIT_PREVIEW } from './edit-style';

// The waypoint and line menu, Cut, Join, Shortcut in App on a real MapLibre map: tiles come from a fixture, the router
// is fake (the route is a bend in the middle, bend). Mouse and fingers are synthetic events on the canvas by
// map.project. Test names are scenarios of the spec route-editing (design add-web-line-tools).

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

// Tbilisi, zoom 15 of the old client: ≈ 100 px between the points
// the basemap is the raster OpenStreetMap: it does not matter for the test, and the default vector basemap
// (OpenFreeMap) with a fixture (a real z12 tile) is drawn in all screen tiles and did not fit into the timeouts under
// the shared load of the browser tests (change openfreemap-default-basemap)
const VIEW = '#m=15/41.69/44.785&l=O';
const A = P(41.687, 44.78);
const B = P(41.69, 44.785);
const C = P(41.693, 44.79);
// a zigzag: an nktk polyline is simplified, and a point on the line between its neighbors would disappear
const Z = [P(41.686, 44.776), P(41.689, 44.779), P(41.686, 44.782), P(41.689, 44.785), P(41.686, 44.788)];
const OTHER = [P(41.694, 44.775), P(41.696, 44.779), P(41.694, 44.783)];

const SEGMENT_MENU = ['Delete segment', 'New track from segment', 'Show elevation profile for segment'];

function link(name: string, segments: LatLng[][]) {
    return saveNktk({ name, segments, points: [] });
}

async function render(hash = VIEW, router: FakeRouter = fakeRouter({ auto: true }), options = {}) {
    localStorage.setItem('nakarte-web:routing-activity', 'hiking');
    const app = await renderApp(tiles, hash, { router, ...options });
    return { ...app, router };
}

function rows() {
    return page.getByRole('list', { name: 'Tracks' }).getByRole('listitem');
}

const unrouted = (map: MaplibreMap) => legs(map).map((leg) => leg.properties?.unrouted);
// the leg states of the edited line: routed, straight, unrouted (a pending leg is not drawn)
const states = (map: MaplibreMap) => legs(map).map((leg) => leg.properties?.state);
// the segment indexes of tracks out of editing (the track layer has no edited segment)
const segmentsOnMap = (map: MaplibreMap) =>
    [
        ...new Set(features<LineString>(map, TRACK_LINES).map((f) => `${f.properties?.id}:${f.properties?.segment}`)),
    ].sort();

// a track A–B–C with two routed legs «Hiking», editing continues, drawing is finished
async function drawABC(map: MaplibreMap) {
    await newTrack(map, [A, B, C]);
    await expect.poll(() => states(map)).toEqual(['routed', 'routed']);
    pressEscape();
    await expect.element(editPanel()).not.toHaveAttribute('data-drawing');
}

// the choice hint stands above the point at, in the center, the gap to the point is not more than 20 px
async function hintAbove(map: MaplibreMap, at: LatLng) {
    const hint = page.getByTestId('tool-hint');
    await expect.element(hint).toBeVisible();
    const box = hint.element().getBoundingClientRect();
    const rect = map.getContainer().getBoundingClientRect();
    const p = map.project([at.lng, at.lat]);
    const x = rect.left + p.x;
    const y = rect.top + p.y;
    const centered = Math.abs((box.left + box.right) / 2 - x) <= 2;
    return centered && box.bottom <= y && y - box.bottom <= 20;
}

async function lengthText() {
    return (await page.getByTestId('track-length').first().element().textContent) ?? '';
}

describe('Меню опорной точки и линии', () => {
    test('Меню средней точки', async () => {
        const { map } = await render();
        await drawABC(map);
        await rightClick(map, B);
        expect(await menuItems()).toEqual(['Cut', 'Reverse', 'Shortcut', 'Delete point', ...SEGMENT_MENU]);
    });

    test('Меню крайней точки', async () => {
        const { map } = await render();
        await drawABC(map);
        await rightClick(map, C);
        const items = await menuItems();
        expect(items).toContain('Join');
        expect(items).not.toContain('Cut');
    });

    test('Меню линии вне редактирования', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}`);
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(1);
        await rightClick(map, P((Z[0].lat + Z[1].lat) / 2, (Z[0].lng + Z[1].lng) / 2));
        await expect.element(editPanel()).toBeVisible();
        expect(await menuItems()).toEqual(['Cut', 'Reverse', 'Shortcut', ...SEGMENT_MENU]);
    });

    test('правый клик мимо линий меню не открывает', async () => {
        const { map } = await render();
        await drawABC(map);
        await rightClick(map, P(41.684, 44.79));
        await new Promise((resolve) => setTimeout(resolve, 100));
        await expect.element(mapMenu()).not.toBeInTheDocument();
    });

    test('Долгое нажатие', async () => {
        const { map } = await render();
        await drawABC(map);
        await longPress(map, B);
        expect(await menuItems()).toContain('Delete point');
        expect(near(waypoints(map)[1], B)).toBe(true);
    });

    test('долгое нажатие на линии — меню линии, точка не вставляется; тап по линии — вставка', async () => {
        const { map } = await render();
        await drawABC(map);
        const [corner] = bend(A, B);
        await longPress(map, corner);
        expect(await menuItems()).toEqual(['Cut', 'Reverse', 'Shortcut', ...SEGMENT_MENU]);
        expect(waypoints(map)).toHaveLength(3);
        // Escape in the menu closes only the menu: the focus is in it, the editor keys do not work there
        await userEvent.keyboard('{Escape}');
        await expect.element(mapMenu()).not.toBeInTheDocument();
        await expect.element(editPanel()).toBeVisible();
        await tap(map, corner);
        await expect.poll(() => waypoints(map)).toHaveLength(4);
    });
});

describe('Удаление опорной точки из меню', () => {
    test('Удалить точку из меню', async () => {
        const { map, router } = await render();
        await drawABC(map);
        await rightClick(map, B);
        await chooseFromMenu('Delete point');
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        // A–C is routed with the activity of the neighbor leg
        expect(router.calls.at(-1)?.activity.id).toBe('hiking');
        expect(near(router.calls.at(-1)?.from as LatLng, A) && near(router.calls.at(-1)?.to as LatLng, C)).toBe(true);
        key({ key: 'z', code: 'KeyZ', metaKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(3);
    });
});

describe('Разрез отрезка', () => {
    test('Разрез в опорной точке', async () => {
        const { map } = await render();
        await drawABC(map);
        await rightClick(map, B);
        await chooseFromMenu('Cut');
        // the first half A–B is edited, routed
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        expect(near(waypoints(map)[1], B)).toBe(true);
        expect(states(map)).toEqual(['routed']);
        await expect.element(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(2);
    });

    test('Разрез посреди маршрута', async () => {
        const { map } = await render();
        await drawABC(map);
        const before = await lengthText();
        const [corner] = bend(A, B);
        await rightClick(map, corner);
        await chooseFromMenu('Cut');
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        expect(near(waypoints(map)[0], A)).toBe(true);
        expect(states(map)).toEqual(['routed']);
        expect(await lengthText()).toBe(before);
    });
});

describe('Склейка отрезков', () => {
    test('Склеить с отрезком другого трека', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}/${link('Other', [OTHER])}`);
        await expect.element(rows()).toHaveLength(2);
        await click(map, Z[4]);
        await expect.element(editPanel()).toBeVisible();
        await rightClick(map, Z[4]);
        await chooseFromMenu('Join');
        await expect.element(page.getByText('Click a track line to join it')).toBeVisible();
        // the cursor over the line Other near its end: the choice line is green and snaps to the end
        const nearEnd = P((OTHER[1].lat + OTHER[2].lat) / 2, (OTHER[1].lng + OTHER[2].lng) / 2);
        fire(map, 'mousemove', nearEnd);
        await expect
            .poll(() => features<LineString>(map, EDIT_PREVIEW).map((f) => f.properties?.color))
            .toEqual(['#16a34a']);
        await click(map, nearEnd);
        await expect.poll(() => waypoints(map)).toHaveLength(8);
        expect(near(waypoints(map)[5], OTHER[2])).toBe(true);
        expect(near(waypoints(map)[7], OTHER[0])).toBe(true);
        await expect.element(rows()).toHaveLength(2);
        // the choice is over (Cancel changed to the check mark), the edit continues without drawing
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        await expect.element(editPanel()).not.toHaveAttribute('data-drawing');
    });

    test('Склеить отрезки одного трека', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Two', [Z, OTHER])}`);
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(2);
        await click(map, Z[0]);
        await rightClick(map, Z[0]);
        await chooseFromMenu('Join');
        await click(map, OTHER[0]);
        await expect.poll(() => waypoints(map)).toHaveLength(8);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(1);
    });

    test('Отмена выбора', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}/${link('Other', [OTHER])}`);
        await click(map, Z[4]);
        await rightClick(map, Z[4]);
        await chooseFromMenu('Join');
        fire(map, 'mousemove', P(41.684, 44.79));
        await expect.poll(() => features<LineString>(map, EDIT_PREVIEW)).toHaveLength(1);
        pressEscape();
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        expect(features<LineString>(map, EDIT_PREVIEW)).toHaveLength(0);
        // a click on another line now starts its editing, not a join
        await click(map, OTHER[1]);
        await expect.poll(() => waypoints(map)).toHaveLength(3);
    });
});

describe('Склейка отрезков: отмена', () => {
    test('клик мимо линий отменяет выбор', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}/${link('Other', [OTHER])}`);
        await click(map, Z[4]);
        await rightClick(map, Z[4]);
        await chooseFromMenu('Join');
        await click(map, P(41.684, 44.79));
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        expect(waypoints(map)).toHaveLength(5);
        await expect.element(rows()).toHaveLength(2);
    });

    test('склейка проложенных частей: отрезки маршрута остаются проложенными', async () => {
        const { map } = await render();
        await drawABC(map);
        // the second segment of the same track: D–E, routed
        const D = P(41.686, 44.786);
        const E = P(41.684, 44.79);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await page.getByRole('button', { name: 'Actions for New track' }).click();
        await page.getByRole('menuitem', { name: 'Add segment' }).click();
        await click(map, D);
        await click(map, E);
        await expect.poll(() => states(map)).toEqual(['routed']);
        pressEscape();
        pressEscape();
        await click(map, A);
        await rightClick(map, C);
        await chooseFromMenu('Join');
        await click(map, D);
        await expect.poll(() => waypoints(map)).toHaveLength(5);
        expect(states(map)).toEqual(['routed', 'routed', 'straight', 'routed']);
    });
});

describe('Срез участка', () => {
    test('Enter отменяет выбор', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Shortcut');
        key({ key: 'Enter', code: 'Enter' });
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        await click(map, Z[3]);
        expect(waypoints(map)).toHaveLength(5);
    });

    test('Срезать петлю', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Shortcut');
        await expect.element(page.getByText('Click the line where the shortcut ends')).toBeVisible();
        // the highlight: the part to remove is red, the choice line is green
        fire(map, 'mousemove', Z[3]);
        await expect
            .poll(() => features<LineString>(map, EDIT_PREVIEW).map((f) => f.properties?.color))
            .toEqual(['#e11d48', '#16a34a']);
        await click(map, Z[3]);
        await expect.poll(() => waypoints(map)).toHaveLength(4);
        expect(near(waypoints(map)[1], Z[1]) && near(waypoints(map)[2], Z[3])).toBe(true);
        key({ key: 'z', code: 'KeyZ', metaKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(5);
    });

    test('Срез из середины маршрута', async () => {
        const { map } = await render();
        await drawABC(map);
        const [corner] = bend(A, B);
        await rightClick(map, corner);
        await chooseFromMenu('Shortcut');
        await click(map, C);
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        // from A to the start point: routed, from the start point to C: straight
        expect(states(map)).toEqual(['routed', 'straight']);
        expect(near(waypoints(map)[1], corner)).toBe(true);
    });

    test('клик, после которого удалять нечего, выбор не заканчивает; клик мимо — отмена', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Zigzag', [Z])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Shortcut');
        await click(map, Z[2]);
        expect(waypoints(map)).toHaveLength(5);
        await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
        await click(map, P(41.694, 44.79));
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        expect(waypoints(map)).toHaveLength(5);
    });
});

describe('Подсказка выбора на карте', () => {
    test('Подсказка у конца линии', async () => {
        // a view centered on the end: at the edge, the hint would press to the margin and stand off the point center
        const { map } = await render(
            `#m=15/${Z[4].lat}/${Z[4].lng}&nktk=${link('Zigzag', [Z])}/${link('Other', [OTHER])}`,
        );
        await click(map, Z[4]);
        await rightClick(map, Z[4]);
        await chooseFromMenu('Join');
        await expect.element(page.getByTestId('tool-hint')).toHaveTextContent('Click a track line to join it');
        expect(await hintAbove(map, Z[4])).toBe(true);
        // on the map, not in the editor row
        expect(editPanel().getByText('Click a track line to join it').query()).toBeNull();
        pressEscape();
        await expect.element(page.getByTestId('tool-hint')).not.toBeInTheDocument();
    });

    test('Подсказка у места начала', async () => {
        const { map } = await render(`#m=15/${Z[1].lat}/${Z[1].lng}&nktk=${link('Zigzag', [Z])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Shortcut');
        await expect.element(page.getByTestId('tool-hint')).toHaveTextContent('Click the line where the shortcut ends');
        expect(await hintAbove(map, Z[1])).toBe(true);
        await click(map, Z[3]);
        await expect.poll(() => waypoints(map)).toHaveLength(4);
        await expect.element(page.getByTestId('tool-hint')).not.toBeInTheDocument();
    });
});

describe('Разворот отрезка', () => {
    test('Развернуть отрезок', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Two', [Z, OTHER])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Reverse');
        await expect.poll(() => near(waypoints(map)[0], Z[4])).toBe(true);
        await expect.element(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await click(map, OTHER[1]);
        expect(near(waypoints(map)[0], OTHER[0])).toBe(true);
    });

    test('проложенный отрезок остаётся проложенным', async () => {
        const { map } = await render();
        await drawABC(map);
        await rightClick(map, B);
        await chooseFromMenu('Reverse');
        await expect.poll(() => near(waypoints(map)[0], C)).toBe(true);
        expect(states(map)).toEqual(['routed', 'routed']);
    });
});

describe('Удаление и вынос отрезка', () => {
    test('Удалить отрезок', async () => {
        const { map } = await render(`${VIEW}&nktk=${link('Two', [Z, OTHER])}`);
        await click(map, Z[1]);
        await rightClick(map, Z[1]);
        await chooseFromMenu('Delete segment');
        await expect.element(editPanel()).not.toBeInTheDocument();
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(1);
        await expect.element(rows()).toHaveLength(1);
    });

    test('Новый трек из отрезка', async () => {
        const { map, router } = await render();
        await drawABC(map);
        await rightClick(map, B);
        await chooseFromMenu('New track from segment');
        await expect.element(rows()).toHaveLength(2);
        await expect.element(rows().nth(1)).toHaveAttribute('data-track', 'New track');
        await expect.element(editPanel()).toBeVisible();
        await page.getByRole('button', { name: 'Finish editing' }).click();
        // the source track is removed, routing is off: a drag of a waypoint of the copy routes its leg again with its
        // own activity, so the markup is copied
        await page.getByRole('button', { name: 'Actions for New track' }).first().click();
        await page.getByRole('menuitem', { name: 'Delete' }).click();
        await expect.element(rows()).toHaveLength(1);
        await page.getByRole('button', { name: /^Routing/ }).click();
        await page.getByRole('menuitemradio', { name: 'Off: straight lines' }).click();
        const calls = router.calls.length;
        await click(map, A);
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        expect(states(map)).toEqual(['routed', 'routed']);
        await drag(map, A, P(41.6865, 44.779));
        await expect.poll(() => router.calls.length).toBe(calls + 1);
        expect(router.calls.at(-1)?.activity.id).toBe('hiking');
    });
});

describe('Разметка маршрута после правки линии', () => {
    test('Перезагрузка после разреза', async () => {
        const autosave = memoryAutosave();
        const first = await render(VIEW, fakeRouter({ auto: true }), { autosave });
        await drawABC(first.map);
        await rightClick(first.map, B);
        await chooseFromMenu('Cut');
        await expect.poll(() => waypoints(first.map)).toHaveLength(2);
        await cleanup();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const { map } = await render(VIEW, fakeRouter({ auto: true }), { autosave });
        await expect.poll(() => segmentsOnMap(map)).toHaveLength(2);
        for (const corner of [bend(A, B)[0], bend(B, C)[0]]) {
            await click(map, corner);
            await expect.poll(() => waypoints(map)).toHaveLength(2);
            expect(states(map)).toEqual(['routed']);
            pressEscape();
            await expect.element(editPanel()).not.toBeInTheDocument();
        }
    });

    test('Отрезок, ждавший маршрута, после разреза — непроложенный', async () => {
        const router = fakeRouter();
        const { map } = await render(VIEW, router);
        await newTrack(map, [A, B, C]);
        pressEscape();
        await rightClick(map, B);
        await chooseFromMenu('Cut');
        await expect.poll(() => unrouted(map)).toEqual([true]);
        expect(router.live()).toHaveLength(0);
        await idle(map);
    });
});
