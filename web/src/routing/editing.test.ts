import { describe, expect, test } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore } from '@/state/store';
import { memoryStorage } from '@/test/memory-storage';
import { createTrackActions } from '@/tracks/actions';
import { geoData, type LatLng } from '@/tracks/model';
import { RoutingError } from './brouter';
import { createRouteEditing } from './editing';
import { fromSegment } from './line';
import type { Router } from './router';

// Scenarios of the specs route-editing, routing and tracks on the connection between the editor and the store: the
// store is real, the router is fake (the test answers each request itself), there is no map.

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const P = (lat: number, lng: number) => ({ lat, lng });
const A = P(41.69, 44.78);
const B = P(41.7, 44.79);
const C = P(41.71, 44.8);

interface Call {
    from: LatLng;
    to: LatLng;
    resolve(points: LatLng[]): void;
    reject(error: Error): void;
}

function setup(activity: string | null = 'hiking') {
    const store = createAppStore({
        catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base: 'O', overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
        routingActivity: activity,
    });
    const calls: Call[] = [];
    let warmUps = 0;
    const router: Router = {
        route: (from, to, _activity, signal) =>
            new Promise((resolve, reject) => {
                calls.push({ from, to, resolve, reject });
                signal?.addEventListener('abort', () => reject(signal.reason));
            }),
        warmUp: () => {
            warmUps += 1;
        },
        isReachable: async () => true,
        status: () => 'ready',
        subscribe: () => () => {},
    };
    const messages: string[] = [];
    const storage = memoryStorage();
    const editing = createRouteEditing({
        store,
        router,
        engine: 'server',
        notify: (title) => messages.push(title),
        storage,
    });
    const actions = createTrackActions({
        store,
        sources: { fetch: globalThis.fetch, corsProxyUrl: '', tracksStorageServer: '', elevationsServer: '' },
        notify: () => {},
        location: () => ({ origin: '', pathname: '', hash: '' }),
    });
    return { store, editing, actions, calls, messages, storage, warmUps: () => warmUps };
}

const tracks = (ctx: ReturnType<typeof setup>) => ctx.store.getState().tracks;
const edit = (ctx: ReturnType<typeof setup>) => ctx.store.getState().routeEdit;

describe('Действия со списком', () => {
    test('Новый трек', async () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        expect(edit(ctx)?.drawing).toBe('end');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.calls[0].resolve([P(41.695, 44.785)]);
        await flush();
        ctx.editing.stopDrawing();
        ctx.editing.stop();
        expect(tracks(ctx)).toHaveLength(1);
        expect(tracks(ctx)[0].name).toBe('New track');
        expect(tracks(ctx)[0].segments).toEqual([[A, P(41.695, 44.785), B]]);
        expect(edit(ctx)).toBeNull();
    });

    test('название из поля ввода', () => {
        const ctx = setup();
        ctx.editing.newTrack('Kazbegi');
        expect(tracks(ctx)[0].name).toBe('Kazbegi');
    });
});

describe('Начало и конец редактирования', () => {
    test('Пустой новый трек', () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        // Escape two times: the end of drawing, the end of editing
        ctx.editing.stopDrawing();
        expect(edit(ctx)).not.toBeNull();
        ctx.editing.stop();
        expect(tracks(ctx)).toEqual([]);
    });

    test('отрезок меньше двух точек удаляется, трек с другими отрезками остаётся', () => {
        const ctx = setup();
        const [track] = ctx.store.getState().addTracks([geoData('Two', { segments: [[A, B]] })]);
        ctx.editing.addSegment(track.id);
        ctx.editing.click(C);
        ctx.editing.stop();
        expect(tracks(ctx)[0].segments).toEqual([[A, B]]);
    });

    test('трек скрыли во время редактирования — редактирование заканчивается', () => {
        const ctx = setup();
        const [track] = ctx.store.getState().addTracks([geoData('Two', { segments: [[A, B]] })]);
        ctx.editing.start(track.id, 0);
        ctx.store.getState().updateTrack(track.id, { visible: false });
        expect(edit(ctx)).toBeNull();
    });
});

describe('Действия с треком', () => {
    test('Добавить отрезок', async () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([geoData('One', { segments: [[A, B]] })]);
        ctx.editing.addSegment(track.id);
        expect(edit(ctx)).toMatchObject({ segment: 1, drawing: 'end' });
        ctx.editing.click(C);
        ctx.editing.click(P(41.72, 44.81));
        ctx.editing.stop();
        expect(tracks(ctx)[0].segments).toHaveLength(2);
    });

    test('Развернуть проложенный трек', async () => {
        const ctx = setup('road-bike');
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.calls[0].resolve([P(41.695, 44.785)]);
        await flush();
        ctx.editing.stop();
        ctx.actions.reverse(tracks(ctx)[0]);
        ctx.editing.start(tracks(ctx)[0].id, 0);
        // after the reverse, the waypoints are B and A, and a drag of A routes B–A again as «Road bike»
        expect(edit(ctx)?.line.waypoints).toEqual([B, A]);
        ctx.editing.moveWaypoint(1, P(41.689, 44.779));
        expect(edit(ctx)?.line.legs[0]).toMatchObject({ state: 'pending', activity: 'road-bike' });
    });
});

describe('копии трека с ожидающим отрезком', () => {
    test('разворот и дублирование во время запроса: отрезок непроложенный, а не вечный спиннер', () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.actions.duplicate(tracks(ctx)[0]);
        ctx.actions.reverse(tracks(ctx)[0]);
        for (const track of tracks(ctx)) {
            expect(track.routes?.[0]?.legs).toEqual([{ state: 'failed', activity: 'hiking' }]);
        }
    });
});

describe('История переживает выход из редактирования', () => {
    test('Повторный вход', () => {
        const ctx = setup(null);
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.editing.click(C);
        ctx.editing.stop();
        ctx.editing.start(tracks(ctx)[0].id, 0);
        expect(edit(ctx)?.canUndo).toBe(true);
        ctx.editing.undo();
        expect(tracks(ctx)[0].segments[0]).toEqual([A, B]);
    });

    test('Линию изменили снаружи', () => {
        const ctx = setup(null);
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.editing.stop();
        ctx.actions.reverse(tracks(ctx)[0]);
        ctx.editing.start(tracks(ctx)[0].id, 0);
        expect(edit(ctx)?.canUndo).toBe(false);
    });

    test('маршрут, пришедший после выхода, внешним изменением не считается', async () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.editing.stop();
        ctx.calls[0].resolve([P(41.695, 44.785)]);
        await flush();
        expect(tracks(ctx)[0].segments[0]).toEqual([A, P(41.695, 44.785), B]);
        ctx.editing.start(tracks(ctx)[0].id, 0);
        expect(edit(ctx)?.canUndo).toBe(true);
        expect(fromSegment(tracks(ctx)[0].segments[0], tracks(ctx)[0].routes?.[0]).legs[0].state).toBe('routed');
    });

    test('трек удалили — запросы его редактора отменены, ответ ничего не пишет', async () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.store.getState().removeTracks([tracks(ctx)[0].id]);
        expect(edit(ctx)).toBeNull();
        ctx.calls[0].resolve([P(41.695, 44.785)]);
        await flush();
        expect(tracks(ctx)).toEqual([]);
    });
});

describe('Недоступный роутер', () => {
    test('Сервер остановлен во время работы', async () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.editing.click(C);
        for (const call of ctx.calls) {
            call.reject(new RoutingError('BRouter is not reachable', true));
        }
        await flush();
        // both legs are straight and marked, there is one warning, the button is red
        expect(edit(ctx)?.line.legs.map((leg) => leg.state)).toEqual(['failed', 'failed']);
        expect(ctx.messages).toEqual([
            'BRouter is not running, start it with docker compose up -d. Lines stay straight until then.',
        ]);
        expect(ctx.store.getState().routerReachable).toBe(false);
    });

    test('Роутер снова доступен', async () => {
        const ctx = setup();
        ctx.store.getState().setRouterReachable(false);
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.calls[0].resolve([]);
        await flush();
        expect(ctx.store.getState().routerReachable).toBe(true);
    });

    test('Нет маршрута: уведомление с причиной', async () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        ctx.calls[0].reject(new RoutingError('datafile E30_N55.rd5 not found'));
        await flush();
        expect(ctx.messages).toEqual(['Routing failed: no routing data for this area']);
        expect(tracks(ctx)[0].segments[0]).toEqual([A, B]);
    });
});

describe('Выбор активности', () => {
    test('выбор сохраняется и прогревает движок, «Off» — нет', () => {
        const ctx = setup(null);
        ctx.editing.setActivity('gravel');
        expect(ctx.store.getState().routingActivity).toBe('gravel');
        expect(ctx.storage.getItem('nakarte-web:routing-activity')).toBe('gravel');
        expect(ctx.warmUps()).toBe(1);
        ctx.editing.setActivity(null);
        expect(ctx.storage.getItem('nakarte-web:routing-activity')).toBeNull();
        expect(ctx.warmUps()).toBe(1);
    });

    test('Прокладка выключена: новые отрезки прямые', () => {
        const ctx = setup(null);
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B);
        expect(ctx.calls).toHaveLength(0);
        expect(edit(ctx)?.line.legs).toEqual([{ state: 'straight' }]);
    });

    test('Alt-клик', () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        ctx.editing.click(A);
        ctx.editing.click(B, true);
        expect(ctx.calls).toHaveLength(0);
    });
});

// Line tools (spec route-editing, design add-web-line-tools): list operations on the edited segment
describe('инструменты линии', () => {
    const D = P(41.72, 44.81);
    const E = P(41.73, 44.82);

    // a track A–B–C with two routed legs, editing is finished
    async function routedTrack(ctx: ReturnType<typeof setup>) {
        ctx.editing.newTrack('Walk');
        for (const point of [A, B, C]) {
            ctx.editing.click(point);
        }
        for (const call of ctx.calls) {
            call.resolve([P((call.from.lat + call.to.lat) / 2 + 0.001, (call.from.lng + call.to.lng) / 2)]);
        }
        await flush();
        ctx.editing.stop();
        return tracks(ctx)[0];
    }

    const states = (route: { legs: readonly { state: string }[] } | null | undefined) =>
        route?.legs.map((leg) => leg.state);

    test('Разрез в опорной точке: две половины на месте отрезка, разметка у обеих, редактируется первая', async () => {
        const ctx = setup();
        const track = await routedTrack(ctx);
        ctx.editing.start(track.id, 0);
        ctx.editing.cut({ waypoint: 1 });
        const [cut] = tracks(ctx);
        expect(cut.segments).toHaveLength(2);
        expect(cut.segments[0][0]).toEqual(A);
        expect(cut.segments[0].at(-1)).toEqual(B);
        expect(cut.segments[1][0]).toEqual(B);
        expect(states(cut.routes?.[0])).toEqual(['routed']);
        expect(states(cut.routes?.[1])).toEqual(['routed']);
        expect(edit(ctx)).toMatchObject({ trackId: track.id, segment: 0, canUndo: false });
        expect(edit(ctx)?.line.waypoints).toEqual([A, B]);
    });

    test('разрез во время прокладки: ожидавшие отрезки — непроложенные, запросы отменены', () => {
        const ctx = setup();
        ctx.editing.newTrack('');
        for (const point of [A, B, C]) {
            ctx.editing.click(point);
        }
        ctx.editing.cut({ waypoint: 1 });
        const [track] = tracks(ctx);
        expect(states(track.routes?.[0])).toEqual(['failed']);
        expect(states(track.routes?.[1])).toEqual(['failed']);
        expect(edit(ctx)?.line.legs[0]).toMatchObject({ state: 'failed', activity: 'hiking' });
    });

    test('разрез второго отрезка трека не сдвигает первый', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([
            geoData('Two', {
                segments: [
                    [D, E],
                    [A, B, C],
                ],
            }),
        ]);
        ctx.editing.start(track.id, 1);
        ctx.editing.cut({ leg: 0, latlng: P(41.695, 44.785) });
        const [cut] = tracks(ctx);
        expect(cut.segments.map((segment) => segment.length)).toEqual([2, 2, 3]);
        expect(cut.segments[0]).toEqual([D, E]);
        expect(edit(ctx)?.segment).toBe(1);
    });

    test('Склеить отрезки одного трека: один отрезок, редактирование продолжается', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([
            geoData('Two', {
                segments: [
                    [A, B],
                    [C, D],
                ],
            }),
        ]);
        ctx.editing.start(track.id, 1);
        ctx.editing.startJoin('start');
        expect(ctx.store.getState().lineTool).toEqual({ kind: 'join', end: 'start' });
        // the end B of the first segment attaches to the start of C–D
        ctx.editing.join(track.id, 0, 'end');
        const [joined] = tracks(ctx);
        expect(joined.segments).toEqual([[A, B, C, D]]);
        expect(edit(ctx)).toMatchObject({ segment: 0 });
        expect(ctx.store.getState().lineTool).toBeNull();
    });

    test('Склеить с отрезком другого трека: тот трек не меняется, разметка обеих частей на месте', async () => {
        const ctx = setup();
        const walk = await routedTrack(ctx);
        const [other] = ctx.store.getState().addTracks([
            geoData('Other', {
                segments: [[D, P(41.725, 44.83), E]],
                routes: [{ waypoints: [0, 2], legs: [{ state: 'routed', activity: 'mtb' }] }],
            }),
        ]);
        ctx.editing.start(walk.id, 0);
        ctx.editing.startJoin('end');
        // the end nearer to C is D: Other attaches with its start
        const before = ctx.calls.length;
        ctx.editing.join(other.id, 0, 'start');
        // the seam C–D is routed with the current activity (change route-join-seam)
        expect(states(tracks(ctx)[0].routes?.[0])).toEqual(['routed', 'routed', 'pending', 'routed']);
        expect(ctx.calls).toHaveLength(before + 1);
        expect(ctx.calls[before].from).toEqual(C);
        expect(ctx.calls[before].to).toEqual(D);
        ctx.calls[before].resolve([P(41.72, 44.82)]);
        await flush();
        const [joined, untouched] = tracks(ctx);
        expect(untouched).toBe(other);
        expect(untouched.segments).toEqual([[D, P(41.725, 44.83), E]]);
        expect(joined.segments[0].at(-1)).toEqual(E);
        expect(states(joined.routes?.[0])).toEqual(['routed', 'routed', 'routed', 'routed']);
        expect(joined.routes?.[0]?.legs[2]).toMatchObject({ state: 'routed', activity: 'hiking' });
        expect(joined.routes?.[0]?.legs.at(-1)).toEqual({ state: 'routed', activity: 'mtb' });
    });

    test('склеить с самим собой нельзя', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([geoData('One', { segments: [[A, B]] })]);
        ctx.editing.start(track.id, 0);
        ctx.editing.startJoin('end');
        ctx.editing.join(track.id, 0, 'start');
        expect(tracks(ctx)[0].segments).toEqual([[A, B]]);
    });

    test('Удалить отрезок: трек остаётся даже пустым, редактирование заканчивается', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([geoData('One', { segments: [[A, B]] })]);
        ctx.editing.start(track.id, 0);
        ctx.editing.deleteSegment();
        expect(tracks(ctx)).toHaveLength(1);
        expect(tracks(ctx)[0].segments).toEqual([]);
        expect(edit(ctx)).toBeNull();
    });

    test('Новый трек из отрезка: копия с разметкой, исходный отрезок редактируется дальше', async () => {
        const ctx = setup();
        const track = await routedTrack(ctx);
        ctx.editing.start(track.id, 0);
        ctx.editing.newTrackFromSegment();
        const [source, copy] = tracks(ctx);
        expect(copy.name).toBe('New track');
        expect(copy.segments).toEqual(source.segments);
        expect(copy.routes).toEqual(source.routes);
        expect(edit(ctx)?.trackId).toBe(source.id);
    });

    test('Срез через выбор на карте — шаг undo; удалять нечего — выбор продолжается', async () => {
        const ctx = setup();
        const track = await routedTrack(ctx);
        ctx.editing.start(track.id, 0);
        ctx.editing.startShortcut({ waypoint: 0 });
        expect(ctx.editing.shortcut({ waypoint: 0 })).toBe(false);
        expect(ctx.store.getState().lineTool).not.toBeNull();
        expect(ctx.editing.shortcut({ waypoint: 2 })).toBe(true);
        expect(ctx.store.getState().lineTool).toBeNull();
        expect(tracks(ctx)[0].segments[0]).toEqual([A, C]);
        expect(edit(ctx)?.canUndo).toBe(true);
        ctx.editing.undo();
        expect(edit(ctx)?.line.waypoints).toEqual([A, B, C]);
    });

    test('меню и выбор закрываются с концом редактирования; рисование заканчивается при открытии меню', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([geoData('One', { segments: [[A, B]] })]);
        ctx.editing.start(track.id, 0, 'end');
        ctx.editing.openMenu(10, 20, { kind: 'waypoint', index: 1 });
        expect(edit(ctx)?.drawing).toBeNull();
        expect(ctx.store.getState().mapMenu).toEqual({ x: 10, y: 20, target: { kind: 'waypoint', index: 1 } });
        ctx.editing.stop();
        expect(ctx.store.getState().mapMenu).toBeNull();
        ctx.editing.start(track.id, 0);
        ctx.editing.startJoin('end');
        ctx.editing.stop();
        expect(ctx.store.getState().lineTool).toBeNull();
    });

    test('режим точек кончается, когда трек или переносимую точку удалили', () => {
        const ctx = setup(null);
        const [track] = ctx.store
            .getState()
            .addTracks([geoData('One', { segments: [[A, B]], points: [{ ...C, name: '001' }] })]);
        ctx.actions.startAddPoint(track);
        ctx.actions.remove(track);
        expect(ctx.store.getState().pointTool).toBeNull();
        const [other] = ctx.store.getState().addTracks([geoData('Two', { points: [{ ...C, name: '001' }] })]);
        const [point] = other.points;
        ctx.actions.startMovePoint(other.id, point);
        ctx.actions.removePoint(other.id, point);
        expect(ctx.store.getState().pointTool).toBeNull();
    });

    test('постановка точек трека заканчивает редактирование, редактирование — постановку', () => {
        const ctx = setup(null);
        const [track] = ctx.store.getState().addTracks([geoData('One', { segments: [[A, B]] })]);
        ctx.editing.start(track.id, 0);
        ctx.store.getState().setPointTool({ kind: 'add', trackId: track.id });
        expect(edit(ctx)).toBeNull();
        ctx.editing.start(track.id, 0);
        expect(ctx.store.getState().pointTool).toBeNull();
    });
});
