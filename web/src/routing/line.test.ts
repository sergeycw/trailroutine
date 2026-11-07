import { describe, expect, test } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore } from '@/state/store';
import { createTrackActions } from '@/tracks/actions';
import { geoData } from '@/tracks/model';
import { fromSegment, type RouteLine, reverseRoute, simplifyRouted, toSegment } from './line';

const A = { lat: 41.69, lng: 44.78 };
const R1 = { lat: 41.692, lng: 44.782 };
const R2 = { lat: 41.694, lng: 44.786 };
const B = { lat: 41.7, lng: 44.79 };
const C = { lat: 41.71, lng: 44.8 };

// A ─(road-bike: R1, R2)─ B ── C
const LINE: RouteLine = {
    waypoints: [A, B, C],
    legs: [{ state: 'routed', activity: 'road-bike', points: [R1, R2] }, { state: 'straight' }],
};

describe('разметка маршрута в отрезке трека', () => {
    test('Построенный отрезок: все узлы — точки линии, разметка — номера опорных', () => {
        const { points, route } = toSegment(LINE);
        expect(points).toEqual([A, R1, R2, B, C]);
        expect(route).toEqual({
            waypoints: [0, 3, 4],
            legs: [{ state: 'routed', activity: 'road-bike' }, { state: 'straight' }],
        });
        expect(fromSegment(points, route)).toEqual(LINE);
    });

    test('ломаная без разметки: каждая точка — опорная, отрезки прямые, разметки нет', () => {
        const line = fromSegment([A, B, C]);
        expect(line.waypoints).toEqual([A, B, C]);
        expect(line.legs).toEqual([{ state: 'straight' }, { state: 'straight' }]);
        expect(toSegment(line).route).toBeNull();
    });

    test('негодная разметка отбрасывается', () => {
        const points = [A, R1, B];
        for (const waypoints of [[0, 1], [1, 2], [0, 2, 1], []]) {
            expect(fromSegment(points, { waypoints, legs: [{ state: 'straight' }] }).waypoints).toEqual(points);
        }
        // markup of straight legs only gives the same polyline
        expect(
            fromSegment(points, { waypoints: [0, 1, 2], legs: [{ state: 'straight' }, { state: 'straight' }] })
                .waypoints,
        ).toEqual(points);
        // a straight leg with intermediate nodes
        expect(fromSegment(points, { waypoints: [0, 2], legs: [{ state: 'straight' }] }).waypoints).toEqual(points);
    });

    test('непроложенный и ожидающий отрезки — прямые с активностью; ожидающий без запроса становится непроложенным', () => {
        const line: RouteLine = {
            waypoints: [A, B, C],
            legs: [
                { state: 'failed', activity: 'mtb' },
                { state: 'pending', activity: 'gravel', request: 7 },
            ],
        };
        const { points, route } = toSegment(line);
        expect(points).toEqual([A, B, C]);
        expect(fromSegment(points, route).legs).toEqual([
            { state: 'failed', activity: 'mtb' },
            { state: 'failed', activity: 'gravel' },
        ]);
    });

    test('разворот разметки', () => {
        const { points, route } = toSegment(LINE);
        const reversed = reverseRoute(route, points.length);
        const line = fromSegment([...points].reverse(), reversed);
        expect(line.waypoints).toEqual([C, B, A]);
        expect(line.legs).toEqual([
            { state: 'straight' },
            { state: 'routed', activity: 'road-bike', points: [R2, R1] },
        ]);
    });
});

describe('упрощение с опорными точками', () => {
    // waypoints on one straight line: a normal simplification would drop the middle one
    const W0 = { lat: 0, lng: 0 };
    const W1 = { lat: 0, lng: 0.01 };
    const W2 = { lat: 0, lng: 0.02 };
    // route points between W0 and W1: the middle one is on the line between its neighbors, the simplification drops it
    const r = (lng: number, lat = 0.001) => ({ lat, lng });

    test('опорные точки остаются, точки маршрута упрощаются, номера пересчитаны', () => {
        const points = [W0, r(0.002), r(0.005), r(0.008), W1, W2];
        const route = {
            waypoints: [0, 4, 5],
            legs: [{ state: 'routed', activity: 'hiking' } as const, { state: 'straight' } as const],
        };
        const result = simplifyRouted(points, route);
        expect(result?.points).toEqual([W0, r(0.002), r(0.008), W1, W2]);
        expect(result?.route).toEqual({ waypoints: [0, 3, 4], legs: route.legs });
        expect(fromSegment(result?.points ?? [], result?.route).waypoints).toEqual([W0, W1, W2]);
    });

    test('ожидающий отрезок становится непроложенным', () => {
        const result = simplifyRouted([W0, W1], { waypoints: [0, 1], legs: [{ state: 'pending', activity: 'mtb' }] });
        expect(result?.route.legs).toEqual([{ state: 'failed', activity: 'mtb' }]);
    });

    test('линия через 180° разворачивается целиком', () => {
        const points = [
            { lat: 0, lng: 179.99 },
            { lat: 0.001, lng: -179.995 },
            { lat: 0, lng: -179.99 },
        ];
        const result = simplifyRouted(points, { waypoints: [0, 2], legs: [{ state: 'routed', activity: 'mtb' }] });
        expect(result?.points.map((p) => p.lng)).toEqual([179.99, 180.005, 180.01]);
    });

    test('без разметки или с негодной — null', () => {
        expect(simplifyRouted([W0, W1], null)).toBeNull();
        expect(simplifyRouted([W0, W1, W2], { waypoints: [0, 1], legs: [{ state: 'straight' }] })).toBeNull();
    });
});

function trackStore() {
    const store = createAppStore({
        catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base: 'O', overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
    });
    const actions = createTrackActions({
        store,
        sources: { fetch: globalThis.fetch, corsProxyUrl: '', tracksStorageServer: '', elevationsServer: '' },
        notify: () => {},
        location: () => ({ origin: '', pathname: '', hash: '' }),
    });
    const { points, route } = toSegment(LINE);
    const [track] = store.getState().addTracks([geoData('Route', { segments: [points], routes: [route] })]);
    return { store, actions, track };
}

describe('разметка в сторе треков', () => {
    test('новые отрезки без разметки сбрасывают её', () => {
        const { store, track } = trackStore();
        store.getState().updateTrack(track.id, { segments: [[A, C]] });
        expect(store.getState().tracks[0].routes).toBeUndefined();
        store.getState().updateTrack(track.id, { name: 'Renamed' });
        expect(store.getState().tracks[0].segments).toEqual([[A, C]]);
    });

    test('Развернуть проложенный трек: разметка разворачивается вместе с отрезком', () => {
        const { store, actions, track } = trackStore();
        actions.reverse(track);
        const reversed = store.getState().tracks[0];
        const line = fromSegment(reversed.segments[0], reversed.routes?.[0]);
        expect(line.waypoints).toEqual([C, B, A]);
        expect(line.legs[1]).toEqual({ state: 'routed', activity: 'road-bike', points: [R2, R1] });
    });

    test('дублирование и новый трек из видимых копируют разметку', () => {
        const { store, actions, track } = trackStore();
        actions.duplicate(track);
        store.getState().addTracks([geoData('Plain', { segments: [[A, C]] })]);
        actions.newTrackFromVisible();
        const [, copy, , merged] = store.getState().tracks;
        expect(fromSegment(copy.segments[0], copy.routes?.[0])).toEqual(LINE);
        expect(merged.routes).toEqual([toSegment(LINE).route, toSegment(LINE).route, null]);
    });
});
