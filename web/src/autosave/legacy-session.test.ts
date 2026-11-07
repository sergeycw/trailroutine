import { describe, expect, test } from 'vitest';
import type { LatLng } from '@/tracks/model';
import { ARC_UNIT, saveNktk } from '@/tracks/nktk';
import { legacyRoute, legacySessionTracks } from './legacy-session';

// Points on the nktk grid, as the track string of an old client session kept them
const grid = (lat: number, lng: number): LatLng => ({
    lat: Math.round(lat * ARC_UNIT) / ARC_UNIT,
    lng: Math.round(lng * ARC_UNIT) / ARC_UNIT,
});
// routeMarkupKey of the old client
const key = ({ lat, lng }: LatLng) => `${Math.round(lat * ARC_UNIT)},${Math.round(lng * ARC_UNIT)}`;

const A = grid(41.69, 44.77);
const r1 = grid(41.691, 44.772);
const r2 = grid(41.692, 44.774);
const B = grid(41.693, 44.776);
const r3 = grid(41.694, 44.778);
const C = grid(41.695, 44.78);

describe('legacyRoute', () => {
    test('нога разметки — проложенный отрезок, остальное — прямые', () => {
        expect(legacyRoute([A, r1, r2, B, C], { legs: [[key(A), key(B), 'hiking']] })).toEqual({
            waypoints: [0, 3, 4],
            legs: [{ state: 'routed', activity: 'hiking' }, { state: 'straight' }],
        });
    });

    test('две ноги подряд и нога, записанная от конца к началу', () => {
        expect(
            legacyRoute([A, r1, B, r3, C], {
                legs: [
                    [key(A), key(B), 'gravel'],
                    [key(C), key(B), 'mtb'],
                ],
            }),
        ).toEqual({
            waypoints: [0, 2, 4],
            legs: [
                { state: 'routed', activity: 'gravel' },
                { state: 'routed', activity: 'mtb' },
            ],
        });
    });

    test('неизвестная активность — точки остаются опорными', () => {
        expect(legacyRoute([A, r1, B], { legs: [[key(A), key(B), 'ski-touring']] })).toBeNull();
    });

    test('ключи без пары в отрезке — без разметки', () => {
        expect(legacyRoute([A, r1, B], { legs: [[key(A), key(C), 'hiking']] })).toBeNull();
    });

    test('нога без точек между концами не считается, как у старого клиента', () => {
        expect(legacyRoute([A, B], { legs: [[key(A), key(B), 'hiking']] })).toBeNull();
    });

    test('мусор вместо разметки', () => {
        expect(legacyRoute([A, r1, B], null)).toBeNull();
        expect(legacyRoute([A, r1, B], { legs: 'x' })).toBeNull();
        expect(legacyRoute([A, r1, B], { legs: [[1, 2, 3], null] })).toBeNull();
    });
});

describe('legacySessionTracks', () => {
    test('треки строки сессии с разметкой по ногам', () => {
        const tracks = [
            saveNktk({ name: 'Route', segments: [[A, r1, r2, B, C]], points: [] }),
            saveNktk({ name: 'Plain', segments: [[A, C]], points: [{ ...B, name: 'pass' }] }),
        ].join('/');
        const result = legacySessionTracks({ tracks, routeMarkup: { legs: [[key(A), key(B), 'road-bike']] } });
        expect(result.map((track) => track.name)).toEqual(['Route', 'Plain']);
        expect(result[0].routes).toEqual([
            { waypoints: [0, 3, 4], legs: [{ state: 'routed', activity: 'road-bike' }, { state: 'straight' }] },
        ]);
        expect(result[1].routes).toBeUndefined();
        expect(result[1].points.map((point) => point.name)).toEqual(['pass']);
    });

    test('без треков — пусто', () => {
        expect(legacySessionTracks(undefined)).toEqual([]);
        expect(legacySessionTracks({ tracks: '' })).toEqual([]);
        expect(legacySessionTracks({ tracks: 42 })).toEqual([]);
    });
});
