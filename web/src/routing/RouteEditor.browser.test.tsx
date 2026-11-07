import type { LineString } from 'geojson';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { type FakeRouter, fakeRouter } from '@/test/fake-router';
import {
    click,
    dblclick,
    drag,
    editPanel,
    features,
    fire,
    idle,
    key,
    legs,
    near,
    newTrack,
    P,
    pressEscape,
    waypoints,
} from '@/test/map-events';
import { openTracks, renderApp, tracksButton } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { type LatLng, TRACK_COLORS } from '@/tracks/model';
import { saveNktk } from '@/tracks/nktk';
import { TRACK_LINES } from '@/tracks/style';
import { RoutingError } from './brouter';
import { EDIT_PREVIEW } from './edit-style';

// The route editor in App on a real MapLibre map: tiles come from a fixture, the router is fake (the test answers the
// requests itself). Mouse: synthetic events on the canvas by map.project, so that both MapLibre and the drag handlers
// on window get them. Test names are scenarios of the specs route-editing, routing and tracks.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(() => {
    cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

// Tbilisi, zoom 15 of the old client: ≈ 100 px between the points
// the basemap is the raster OpenStreetMap: it does not matter for the test, and the default vector basemap
// (OpenFreeMap) with a fixture (a real z12 tile) is drawn in all screen tiles and did not fit into the timeouts under
// the shared load of the browser tests (change openfreemap-default-basemap)
const VIEW = '#m=15/41.69/44.785&l=O';
const badge = () => page.getByTestId('routing-badge');
const A = P(41.687, 44.78);
const B = P(41.69, 44.785);
const C = P(41.693, 44.79);
const D = P(41.684, 44.775);

function line(name: string, points: LatLng[]) {
    return saveNktk({ name, segments: [points], points: [] });
}

async function render(hash: string, router: FakeRouter = fakeRouter({ auto: true }), activity?: string) {
    if (activity) {
        localStorage.setItem('nakarte-web:routing-activity', activity);
    }
    const app = await renderApp(tiles, hash, { router });
    return { ...app, router };
}

describe('Начало и конец редактирования', () => {
    test('Начать редактирование', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`);
        await expect.poll(() => features(map, TRACK_LINES)).toHaveLength(1);
        await click(map, B);
        await expect.element(editPanel()).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
        await expect.element(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
        await expect.element(page.getByRole('button', { name: 'Finish editing' })).toBeVisible();
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });

    test('Закончить редактирование', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`);
        await click(map, B);
        await expect.element(editPanel()).toBeVisible();
        await click(map, D);
        await expect.element(editPanel()).not.toBeInTheDocument();
        await expect.poll(() => waypoints(map)).toHaveLength(0);
        await expect.poll(() => features(map, TRACK_LINES)).toHaveLength(1);
    });

    test('Пустой новый трек', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A]);
        pressEscape();
        pressEscape();
        await expect.element(editPanel()).not.toBeInTheDocument();
        await expect.element(page.getByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
    });
});

describe('Название трека в панели редактирования', () => {
    test('Переименовать в редакторе', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`);
        await click(map, B);
        const name = editPanel().getByRole('textbox', { name: 'Track name' });
        await name.fill('Kazbek');
        await userEvent.keyboard('{Enter}');
        await expect.element(name).toHaveValue('Kazbek');
        await expect.element(editPanel()).toBeVisible();
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await openTracks();
        await expect.element(page.getByRole('button', { name: 'Kazbek' })).toBeVisible();
    });

    test('Пустое название в редакторе', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`);
        await click(map, B);
        const name = editPanel().getByRole('textbox', { name: 'Track name' });
        await name.fill('');
        // a focus loss acts as a map click, without the end of editing
        (name.element() as HTMLInputElement).blur();
        await expect.element(name).toHaveValue('Walk');
    });

    test('Escape в поле названия', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`);
        await click(map, B);
        const name = editPanel().getByRole('textbox', { name: 'Track name' });
        await name.fill('Discarded');
        await userEvent.keyboard('{Escape}');
        await expect.element(name).toHaveValue('Walk');
        await expect.element(editPanel()).toBeVisible();
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });
});

describe('Меню «Share track»', () => {
    test('Экспорт из редактора', async () => {
        const saved: string[] = [];
        const blobs: Blob[] = [];
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            saved.push(this.download);
        });
        const createObjectURL = URL.createObjectURL.bind(URL);
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
            blobs.push(blob as Blob);
            return createObjectURL(blob);
        });
        try {
            const { map } = await render(`${VIEW}&nktk=${line('Kazbek', [A, C])}`);
            await click(map, B);
            await page.getByRole('button', { name: 'Share track' }).click();
            await page.getByRole('menuitem', { name: 'Save as GPX', exact: true }).click();
            // the test has no elevation API: the same GPX, no elevations (spec track-files, «GPX с высотами»)
            await expect.poll(() => saved).toEqual(['Kazbek.gpx']);
            // the file has the track line: a segment with points
            const gpx = await blobs[0].text();
            expect(gpx).toContain('<name>Kazbek</name>');
            expect(gpx.match(/<trkpt /gu)?.length).toBeGreaterThanOrEqual(2);
            await expect.element(editPanel()).toBeVisible();
        } finally {
            vi.restoreAllMocks();
        }
    });

    test('Пункты меню Share track', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Kazbek', [A, C])}`);
        await click(map, B);
        await page.getByRole('button', { name: 'Share track' }).click();
        const menu = page.getByRole('menu');
        await expect.element(menu).toBeVisible();
        // GPX comes with elevations without a separate item, «Send to device» is removed (design trim-track-menus)
        expect(
            menu
                .getByRole('menuitem')
                .elements()
                .map((item) => item.textContent),
        ).toEqual(['Save as GPX', 'Save as KML', 'Copy link for track']);
        await userEvent.keyboard('{Escape}');
        await expect.element(editPanel()).toBeVisible();
    });
});

describe('Цвет трека в панели редактирования', () => {
    test('Цвет нового трека', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        await expect.poll(() => legs(map).map((leg) => leg.properties?.color)).toEqual([TRACK_COLORS[0]]);
        await editPanel().getByRole('button', { name: 'Color of New track' }).click();
        await page.getByRole('button', { name: 'Color 3' }).click();
        await expect.poll(() => legs(map).map((leg) => leg.properties?.color)).toEqual([TRACK_COLORS[2]]);
        // drawing continues: the next click places a third point of the same color
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
        await click(map, C);
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        await expect
            .poll(() => legs(map).map((leg) => leg.properties?.color))
            .toEqual([TRACK_COLORS[2], TRACK_COLORS[2]]);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await openTracks();
        await expect
            .poll(() =>
                page
                    .getByRole('button', { name: 'Color of New track' })
                    .element()
                    .querySelector('[data-color]')
                    ?.getAttribute('data-color'),
            )
            .toBe('2');
    });

    test('Свой цвет во время правки', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        await editPanel().getByRole('button', { name: 'Color of New track' }).click();
        await page.getByRole('textbox', { name: 'Hex color' }).fill('#14b8a6');
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => legs(map).map((leg) => leg.properties?.color)).toEqual(['#14b8a6']);
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
    });

    test('Escape, закрывающий палитру, рисование не заканчивает', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A]);
        await editPanel().getByRole('button', { name: 'Color of New track' }).click();
        await expect.element(page.getByRole('button', { name: 'Color 3' })).toBeVisible();
        await userEvent.keyboard('{Escape}');
        await expect.element(page.getByRole('button', { name: 'Color 3' })).not.toBeInTheDocument();
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
        await click(map, B);
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });
});

describe('Клик при рисовании', () => {
    test('Несколько кликов подряд', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B, C]);
        // all three waypoints at once, the legs wait
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        expect(router.live()).toHaveLength(2);
        router.live()[1].resolve([P(41.6915, 44.7875)]);
        router.live()[0].resolve([P(41.6885, 44.7825)]);
        await expect.poll(() => legs(map)).toHaveLength(2);
    });

    test('Ожидание маршрута', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        // a gap between the waypoints, the badge at the pointer shows the wait
        await expect.element(badge()).toBeInTheDocument();
        expect(legs(map)).toHaveLength(0);
        // the end of the edit does not cancel the request: the badge waits until the leg is routed
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.poll(() => page.getByRole('button', { name: 'Finish editing' }).query()).toBeNull();
        fire(map, 'mousemove', C);
        await expect.element(badge()).toBeInTheDocument();
        expect(features(map, TRACK_LINES)).toHaveLength(0);
        router.live()[0].resolve([]);
        // the response came after the edit: the track layer draws the leg now
        await expect.poll(() => features(map, TRACK_LINES)).toHaveLength(1);
        await expect.element(badge()).not.toBeInTheDocument();
    });

    test('Курсор рисования во время ожидания', async () => {
        const { map } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(badge()).toBeInTheDocument();
        expect(map.getCanvas().style.cursor).toContain('data:image/svg+xml');
        expect(map.getCanvas().style.cursor).toContain('crosshair');
    });

    test('резинка от последней точки к курсору', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A]);
        fire(map, 'mousemove', B);
        await expect
            .poll(() => features<LineString>(map, EDIT_PREVIEW).map((f) => f.geometry.type))
            .toEqual(['LineString']);
    });

    test('Alt-клик', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A]);
        await click(map, B, { altKey: true });
        await expect.poll(() => legs(map)).toHaveLength(1);
        expect(router.calls).toHaveLength(0);
    });
});

describe('Ошибка прокладки', () => {
    test('Нет маршрута', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        router.live()[0].reject(new RoutingError('no route found'));
        // a marked straight line between the waypoints, a notice with the reason, no wait badge at the pointer
        await expect.element(page.getByText('Routing failed: no route found')).toBeVisible();
        await expect.poll(() => legs(map).map((f) => f.properties?.unrouted)).toEqual([true]);
        await expect.element(badge()).not.toBeInTheDocument();
    });
});

describe('Бейдж ожидания у указателя', () => {
    test('Указатель ушёл с карты', async () => {
        const { map } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(badge()).toBeInTheDocument();
        map.getCanvas().dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        await expect.element(badge()).not.toBeInTheDocument();
        fire(map, 'mousemove', C);
        await expect.element(badge()).toBeInTheDocument();
        // the badge is to the right of and below the tip
        const canvas = map.getCanvas().getBoundingClientRect();
        const point = map.project([C.lng, C.lat]);
        const box = badge().element().getBoundingClientRect();
        expect(box.left - (canvas.left + point.x)).toBeGreaterThan(0);
        expect(box.top - (canvas.top + point.y)).toBeGreaterThan(0);
        // the badge is still there and follows the pointer
        fire(map, 'mousemove', D);
        const to = map.project([D.lng, D.lat]);
        const moved = badge().element().getBoundingClientRect();
        expect(moved.left - box.left).toBeCloseTo(to.x - point.x, 0);
        expect(moved.top - box.top).toBeCloseTo(to.y - point.y, 0);
    });

    test('Клик сквозь бейдж', async () => {
        const { map } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(badge()).toBeInTheDocument();
        // a badge press hits the canvas: the synthetic click below goes straight to the canvas and does not check this
        const box = badge().element().getBoundingClientRect();
        expect(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)).toBe(map.getCanvas());
        await click(map, C);
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        expect(near(waypoints(map)[2], C)).toBe(true);
    });

    test('Касание без бейджа', async () => {
        const { map } = await render(VIEW, fakeRouter(), 'hiking');
        await page.getByRole('button', { name: 'New track' }).first().click();
        // a touch: a pointer of type touch, then compatibility mouse events: mousemove without a mouse pointermove
        // (fire would add it), and the badge must not appear on it
        for (const point of [A, B]) {
            await idle(map);
            const rect = map.getCanvas().getBoundingClientRect();
            const at = map.project([point.lng, point.lat]);
            const client = { bubbles: true, clientX: rect.left + at.x, clientY: rect.top + at.y };
            map.getCanvas().dispatchEvent(new PointerEvent('pointerdown', { ...client, pointerType: 'touch' }));
            map.getCanvas().dispatchEvent(new MouseEvent('mousemove', client));
            fire(map, 'mousedown', point);
            fire(map, 'mouseup', point);
            fire(map, 'click', point);
        }
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        expect(page.getByTestId('routing-badge').query()).toBeNull();
    });
});

describe('Ожидание прокладки в верхней строке', () => {
    // in the editor row: the open track list under it shows its own routing button
    const routingButton = () => editPanel().getByRole('button', { name: /^Routing/ });

    test('Ожидание в строке редактора', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(routingButton()).toHaveAttribute('aria-busy', 'true');
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing: Hiking. Calculating route');
        router.live()[0].resolve([]);
        await expect.element(routingButton()).not.toHaveAttribute('aria-busy');
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing: Hiking');
    });

    test('Ожидание, пока движок загружается', async () => {
        const { map } = await render(VIEW, fakeRouter({ status: 'loading' }), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(routingButton()).toHaveAttribute('aria-busy', 'true');
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing: Hiking. BRouter engine is loading');
    });

    test('Прокладку выключили во время ожидания', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await routingButton().click();
        await page.getByRole('menuitemradio', { name: 'Off: straight lines' }).click();
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing is off. Calculating route');
        await expect.element(routingButton()).toHaveAttribute('aria-busy', 'true');
        router.live()[0].resolve([]);
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing is off: lines are straight');
    });

    test('Ожидание после конца правки', async () => {
        const { map } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.element(tracksButton()).toHaveAttribute('aria-busy', 'true');
    });

    test('Ответ снимает ожидание', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.element(tracksButton()).toHaveAttribute('aria-busy', 'true');
        router.live()[0].resolve([]);
        await expect.element(tracksButton()).not.toHaveAttribute('aria-busy');
        await expect.element(tracksButton()).toHaveAttribute('title', 'Tracks 1');
    });

    test('Ошибка снимает ожидание', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(routingButton()).toHaveAttribute('aria-busy', 'true');
        router.live()[0].reject(new RoutingError('no route found'));
        await expect.element(routingButton()).not.toHaveAttribute('aria-busy');
        await expect.element(routingButton()).toHaveAttribute('title', 'Routing: Hiking');
    });
});

describe('Вид ожидания прокладки', () => {
    const routingButton = () => editPanel().getByRole('button', { name: /^Routing/ });
    const thread = () => routingButton().getByTestId('route-thread');
    const stroke = () => {
        const path = thread().element().querySelector('path');
        if (!path) {
            throw new Error('нет нитки');
        }
        return getComputedStyle(path);
    };

    test('Нитка на кнопке прокладки', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B]);
        await expect.element(thread()).toBeInTheDocument();
        expect(routingButton().element().querySelector('.animate-spin')).toBeNull();
        expect(stroke().animationName).toBe('route-thread');
        // after the end of the edit, on Tracks
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.element(tracksButton().getByTestId('route-thread')).toBeInTheDocument();
        router.live()[0].resolve([]);
        await expect.element(tracksButton().getByTestId('route-thread')).not.toBeInTheDocument();
    });

    test('Меньше движения', async () => {
        // Chromium replaces the system setting: the test and its iframe are in one page
        const reduce = (value: string) =>
            cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
        await reduce('reduce');
        try {
            const { map } = await render(VIEW, fakeRouter(), 'hiking');
            await newTrack(map, [A, B]);
            await expect.element(thread()).toBeInTheDocument();
            // the thread stays whole: no animation, the stroke is on the visible part, on the button and on the badge
            expect(stroke().animationName).toBe('none');
            expect(stroke().strokeDashoffset).toBe('-270px');
            const onBadge = badge().element().querySelector('path');
            expect(onBadge && getComputedStyle(onBadge).animationName).toBe('none');
        } finally {
            await reduce('');
        }
    });
});

describe('Перетаскивание опорной точки', () => {
    test('Точка между двумя отрезками', async () => {
        const { map, router } = await render(VIEW, fakeRouter({ auto: true }), 'hiking');
        await newTrack(map, [A, B, C]);
        pressEscape();
        const moved = P(41.6915, 44.783);
        await drag(map, B, moved);
        await expect.poll(() => router.calls.length).toBe(4);
        const [toMoved, fromMoved] = router.calls.slice(-2);
        expect(near(toMoved.from, A) && near(toMoved.to, moved)).toBe(true);
        expect(near(fromMoved.from, moved) && near(fromMoved.to, C)).toBe(true);
    });

    test('Route preview during a drag', async () => {
        const { map, router } = await render(VIEW, fakeRouter({ auto: true }), 'hiking');
        await newTrack(map, [A, B, C]);
        pressEscape();
        const routed = router.calls.length;
        const moved = P(41.6915, 44.783);
        fire(map, 'mousemove', B);
        fire(map, 'mousedown', B);
        fire(map, 'mousemove', moved);
        // the pointer rests: both neighbour legs are routed for the preview, the line itself is not
        await expect.poll(() => router.previews.length, { timeout: 3000 }).toBe(2);
        const [toMoved, fromMoved] = router.previews;
        expect(near(toMoved.from, A) && near(toMoved.to, moved)).toBe(true);
        expect(near(fromMoved.from, moved) && near(fromMoved.to, C)).toBe(true);
        expect(router.calls.length).toBe(routed);
        // the preview draws the routed legs: the bend of the fake router is a third point of each line
        await expect
            .poll(() =>
                features<LineString>(map, EDIT_PREVIEW)
                    .filter((f) => f.geometry.type === 'LineString')
                    .map((f) => f.geometry.coordinates.length),
            )
            .toEqual([3, 3]);
        fire(map, 'mouseup', moved);
        fire(map, 'click', moved);
        await expect.poll(() => router.calls.length).toBe(routed + 2);
        expect(router.previews).toHaveLength(2);
    });

    test('ответ роутера во время перетаскивания его не отменяет', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await newTrack(map, [A, B, C]);
        pressEscape();
        // both legs pass the crossroads J ≈ 8 m from B: when the second leg is routed, B moves to J (a spur at a turn)
        const J = P(B.lat, B.lng - 0.0001);
        router.live()[0].resolve([J]);
        await idle(map);
        const moved = P(41.6915, 44.783);
        fire(map, 'mousemove', B);
        fire(map, 'mousedown', B);
        fire(map, 'mousemove', P((B.lat + moved.lat) / 2, (B.lng + moved.lng) / 2));
        router.live()[0].resolve([J, P(41.6915, 44.785)]);
        await expect.poll(() => router.live()).toHaveLength(0);
        fire(map, 'mousemove', moved);
        fire(map, 'mouseup', moved);
        fire(map, 'click', moved);
        await expect.poll(() => router.calls.length).toBe(4);
        const [toMoved, fromMoved] = router.calls.slice(-2);
        expect(near(toMoved.to, moved) && near(fromMoved.from, moved)).toBe(true);
    });
});

describe('Удаление опорной точки двойным кликом', () => {
    test('Удаление средней точки', async () => {
        const { map, router } = await render(VIEW, fakeRouter({ auto: true }), 'hiking');
        await newTrack(map, [A, B, C]);
        pressEscape();
        await dblclick(map, B);
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        const last = router.calls.at(-1);
        expect(last && near(last.from, A) && near(last.to, C)).toBe(true);
    });
});

describe('Вставка опорной точки на линию', () => {
    test('Вставка с перетаскиванием', async () => {
        const { map, router } = await render(`${VIEW}&nktk=${line('Walk', [A, C])}`, fakeRouter({ auto: true }));
        await click(map, B);
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        const target = P(41.6905, 44.7835);
        await drag(map, B, target);
        // a waypoint appeared, after the release the neighbor straight legs stayed straight
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        expect(near(waypoints(map)[1], target)).toBe(true);
        expect(router.calls).toHaveLength(0);
        // insertion and drag are one history step
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });
});

describe('Undo и redo', () => {
    test('Кнопки Undo и Redo', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect.poll(() => waypoints(map)).toHaveLength(1);
        await expect.element(page.getByRole('button', { name: 'Redo' })).toBeEnabled();
        await page.getByRole('button', { name: 'Redo' }).click();
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });

    test('Отмена клика', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        key({ code: 'KeyZ', key: 'z', metaKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(1);
        key({ code: 'KeyZ', key: 'Z', metaKey: true, shiftKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        key({ code: 'KeyZ', key: 'z', ctrlKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(1);
        key({ code: 'KeyY', key: 'y', ctrlKey: true });
        await expect.poll(() => waypoints(map)).toHaveLength(2);
    });

    test('Хоткей в поле ввода', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        const input = page.getByRole('textbox', { name: 'Track name' }).element();
        key({ code: 'KeyZ', key: 'z', metaKey: true }, input);
        await idle(map);
        expect(waypoints(map)).toHaveLength(2);
    });
});

describe('Продолжение линии с любого конца', () => {
    test('Конец рисования', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        pressEscape();
        await click(map, C);
        // a map click past the line without drawing ends editing, there is no new point
        await expect.element(editPanel()).not.toBeInTheDocument();
        await expect.poll(() => features(map, TRACK_LINES)).toHaveLength(1);
        expect(features<LineString>(map, TRACK_LINES)[0].geometry.coordinates).toHaveLength(2);
    });

    test('Дорисовать с начала', async () => {
        // the middle point is off the line: an nktk polyline is simplified, and a point on the line would disappear
        const { map, router } = await render(
            `${VIEW}&nktk=${line('Walk', [A, P(41.692, 44.783), C])}`,
            fakeRouter(),
            'gravel',
        );
        await click(map, P(41.6895, 44.7815));
        await expect.poll(() => waypoints(map)).toHaveLength(3);
        await click(map, A);
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
        await click(map, D);
        await expect.poll(() => waypoints(map)).toHaveLength(4);
        expect(near(waypoints(map)[0], D)).toBe(true);
        expect(router.calls[0].activity.id).toBe('gravel');
        expect(near(router.calls[0].from, D) && near(router.calls[0].to, A)).toBe(true);
    });
});

describe('гонки и фокус', () => {
    test('быстрый клик по только что поставленной точке заканчивает рисование, а не ставит дубль', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A]);
        // without a wait for a frame: the point B did not get to the paint yet
        for (let i = 0; i < 2; i++) {
            for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
                fire(map, type, B);
            }
        }
        await expect.element(editPanel()).not.toHaveAttribute('data-drawing');
        expect(waypoints(map)).toHaveLength(2);
    });

    test('Enter на кнопке Undo в фокусе нажимает её, а не заканчивает рисование', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        const undo = page.getByRole('button', { name: 'Undo' }).element() as HTMLButtonElement;
        undo.focus();
        key({ key: 'Enter', code: 'Enter' }, undo);
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
    });

    test('Escape, закрывающий меню прокладки, рисование не заканчивает', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A]);
        // the routing button is both in the list header and in the editor of the top row: here, the one in the editor
        await page
            .getByTestId('edit-panel')
            .getByRole('button', { name: /^Routing/ })
            .click();
        await expect.element(page.getByRole('menuitemradio', { name: 'Hiking' })).toBeVisible();
        await userEvent.keyboard('{Escape}');
        await expect.element(page.getByRole('menuitemradio', { name: 'Hiking' })).not.toBeInTheDocument();
        await expect.element(editPanel()).toHaveAttribute('data-drawing');
    });
});

describe('Меню активностей', () => {
    async function chooseActivity(name: string) {
        await page.getByRole('button', { name: /^Routing/ }).click();
        await page.getByRole('menuitemradio', { name, exact: true }).click();
    }

    test('Выбор активности', async () => {
        const { router } = await render(VIEW);
        await chooseActivity('Gravel bike');
        await expect.element(page.getByRole('button', { name: 'Routing: Gravel bike' })).toBeVisible();
        expect(localStorage.getItem('nakarte-web:routing-activity')).toBe('gravel');
        // the engine starts to load before the first map click
        expect(router.warmUps).toBeGreaterThan(0);
        await page.getByRole('button', { name: 'Routing: Gravel bike' }).click();
        await expect.element(page.getByRole('menuitemradio', { name: 'Gravel bike' })).toBeChecked();
    });

    test('Прокладка выключена', async () => {
        const { map, router } = await render(VIEW, fakeRouter(), 'hiking');
        await chooseActivity('Off: straight lines');
        await expect.element(page.getByRole('button', { name: 'Routing is off: lines are straight' })).toBeVisible();
        await newTrack(map, [A, B]);
        await expect.poll(() => legs(map)).toHaveLength(1);
        expect(router.calls).toHaveLength(0);
    });

    test('Движок загружается', async () => {
        const router = fakeRouter({ status: 'loading' });
        await render(VIEW, router, 'hiking');
        const loading = page.getByRole('button', { name: 'Routing: Hiking. BRouter engine is loading' });
        await expect.element(loading).toBeVisible();
        // the loading indicator is the wait thread, as for a route wait (spec route-editing, «Вид ожидания прокладки»)
        await expect.element(loading.getByTestId('route-thread')).toBeInTheDocument();
        router.setStatus('ready');
        // The engine is ready
        await expect.element(page.getByRole('button', { name: 'Routing: Hiking', exact: true })).toBeVisible();
    });

    test('Option applies to the next leg', async () => {
        const { map, router } = await render(VIEW, fakeRouter({ auto: true }), 'hiking');
        await page.getByRole('button', { name: /^Routing/ }).click();
        await page.getByRole('menuitemcheckbox', { name: 'Avoid climbs' }).click();
        await page.getByRole('menuitemcheckbox', { name: 'Allow steps' }).click();
        await page.getByRole('menuitem', { name: 'Max difficulty: T3' }).click();
        await page.getByRole('menuitemradio', { name: 'T5 · demanding alpine hiking' }).click();
        await expect.element(page.getByRole('menuitem', { name: /^Max difficulty/ })).not.toBeInTheDocument();
        await newTrack(map, [A, B]);
        await expect.poll(() => router.calls.length).toBeGreaterThan(0);
        expect(router.calls[0].activity.params).toEqual([
            ['SAC_scale_limit', 5],
            ['consider_elevation', 1],
            ['allow_steps', 0],
        ]);
        expect(JSON.parse(localStorage.getItem('nakarte-web:hiking-options') ?? '')).toEqual({
            sacLimit: 5,
            avoidClimbs: true,
            allowSteps: false,
        });
    });

    test('Options only for hiking', async () => {
        await render(VIEW, fakeRouter({ auto: true }), 'gravel');
        await page.getByRole('button', { name: /^Routing/ }).click();
        await expect.element(page.getByRole('menuitemradio', { name: 'Gravel bike' })).toBeChecked();
        await expect.element(page.getByRole('menuitemcheckbox', { name: 'Avoid climbs' })).not.toBeInTheDocument();
    });

    test('Движок в браузере не запустился', async () => {
        const router = fakeRouter({ status: 'failed' });
        await render(VIEW, router, 'hiking');
        // the button is red immediately, without a route and without opening the menu
        await expect.element(page.getByRole('button', { name: /^Routing/ })).toHaveAttribute('data-state', 'down');
        await page.getByRole('button', { name: /^Routing/ }).click();
        await expect
            .element(page.getByRole('menuitem', { name: 'BRouter is not running, start it with docker compose up -d' }))
            .toBeVisible();
        // opening the menu checks again that the router is alive: the button is red, the hint tells what to do
        await expect
            .element(page.getByRole('button', { name: /^Routing: Hiking\. BRouter/ }))
            .toHaveAttribute('data-state', 'down');
    });
});

describe('Действия с треком', () => {
    test('Новый трек', async () => {
        const { map } = await render(VIEW);
        await newTrack(map, [A, B]);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.element(page.getByRole('button', { name: 'New track', exact: true }).last()).toBeVisible();
        await expect.poll(() => features(map, TRACK_LINES)).toHaveLength(1);
    });

    test('Добавить отрезок', async () => {
        const { map } = await render(`${VIEW}&nktk=${line('Walk', [A, B])}`);
        await page.getByRole('button', { name: 'Actions for Walk' }).click();
        await page.getByRole('menuitem', { name: 'Add segment' }).click();
        await click(map, C);
        await click(map, D);
        await page.getByRole('button', { name: 'Finish editing' }).click();
        await expect.poll(() => features(map, TRACK_LINES).map((f) => f.properties?.segment)).toEqual([0, 1]);
    });
});
