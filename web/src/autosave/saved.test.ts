import { describe, expect, test } from 'vitest';
import type { SegmentRoute } from '@/routing/line';
import type { Track } from '@/tracks/model';
import { fromSaved, SAVED_VERSION, toSaved } from './saved';

const A = { lat: 41.690001234567, lng: 44.780009876543 };
const R = { lat: 41.6912, lng: 44.7811 };
// a waypoint exactly on the straight line between A and C: the simplification would remove it
const B = { lat: (A.lat + 41.71) / 2, lng: (A.lng + 44.8) / 2 };
const C = { lat: 41.71, lng: 44.8 };

const ROUTE: SegmentRoute = {
    waypoints: [0, 2, 3],
    legs: [
        { state: 'routed', activity: 'hiking' },
        { state: 'failed', activity: 'mtb' },
    ],
};

function track(fields: Partial<Track> = {}): Track {
    return { id: 't', name: 'T', segments: [], points: [], color: 0, visible: true, ...fields };
}

describe('трек → запись → трек', () => {
    test('точные координаты, разметка, видимость, цвет и отметки', () => {
        const saved = toSaved([
            track({
                name: 'Маршрут',
                segments: [
                    [A, R, B, C],
                    [A, C],
                ],
                routes: [ROUTE, null],
                points: [{ ...C, name: 'Вершина' }],
                color: 3,
                visible: false,
                measureTicksShown: true,
            }),
        ]);
        expect(saved.version).toBe(SAVED_VERSION);
        expect(saved.tracks[0].segments[0]).toBeInstanceOf(Float64Array);
        expect(fromSaved(saved)).toEqual([
            {
                name: 'Маршрут',
                segments: [
                    [A, R, B, C],
                    [A, C],
                ],
                routes: [ROUTE, null],
                points: [{ ...C, name: 'Вершина' }],
                color: 3,
                hidden: true,
                measureTicksShown: true,
            },
        ]);
    });

    test('свой цвет туда и обратно, номер палитры из старой записи — как раньше', () => {
        const saved = toSaved([track({ segments: [[A, C]], color: '#14b8a6' })]);
        expect(fromSaved(saved)?.[0].color).toBe('#14b8a6');
        // a record from before change track-color-picker: a palette index, the same version
        const old = { ...saved, tracks: [{ ...saved.tracks[0], color: 4 }] };
        expect(fromSaved(old)?.[0].color).toBe(4);
    });

    test('без разметки — без routes', () => {
        expect(fromSaved(toSaved([track({ segments: [[A, C]] })]))?.[0].routes).toBeUndefined();
    });

    test('Перезагрузка во время прокладки: ожидающий отрезок восстанавливается непроложенным', () => {
        const pending: SegmentRoute = { waypoints: [0, 1], legs: [{ state: 'pending', activity: 'gravel' }] };
        const [restored] = fromSaved(toSaved([track({ segments: [[A, C]], routes: [pending] })])) ?? [];
        expect(restored.routes).toEqual([{ waypoints: [0, 1], legs: [{ state: 'failed', activity: 'gravel' }] }]);
    });

    test('разметка, которая не сходится с точками, отбрасывается', () => {
        const [restored] =
            fromSaved(
                toSaved([track({ segments: [[A, C]], routes: [{ waypoints: [0, 5], legs: [ROUTE.legs[0]] }] })]),
            ) ?? [];
        expect(restored.routes).toBeUndefined();
    });

    test('отрезок короче двух точек и пустой трек отбрасываются', () => {
        const restored = fromSaved(
            toSaved([
                track({ name: 'drawing', segments: [[A, C], [A]], routes: [ROUTE, null] }),
                track({ name: 'empty', segments: [[]] }),
            ]),
        );
        expect(restored?.map((item) => item.name)).toEqual(['drawing']);
        expect(restored?.[0].segments).toEqual([[A, C]]);
    });
});

describe('чужие и испорченные записи', () => {
    test.each([
        ['нет записи', undefined],
        ['другая версия', { version: 2, tracks: [] }],
        ['не объект', 'nktk'],
        ['без треков', { version: SAVED_VERSION }],
    ])('%s — null', (_, value) => {
        expect(fromSaved(value)).toBeNull();
    });

    test('испорченный трек пропускается, остальные читаются', () => {
        const saved = toSaved([track({ name: 'ok', segments: [[A, C]] })]);
        const value = {
            ...saved,
            tracks: [{ name: 'bad', segments: [[1, 2]] }, saved.tracks[0], null],
        };
        expect(fromSaved(value)?.map((item) => item.name)).toEqual(['ok']);
    });

    test('испорченная разметка — трек без неё', () => {
        const saved = toSaved([track({ segments: [[A, C]] })]);
        for (const route of [
            'x',
            { waypoints: [0, 1], legs: [null] },
            { waypoints: [0, 1], legs: [{ state: 'routed' }] },
            { waypoints: [0, '1'], legs: [{ state: 'routed', activity: 'mtb' }] },
            { waypoints: [0, 1], legs: [{ state: 'flying', activity: 'mtb' }] },
        ]) {
            saved.tracks[0].routes = [route as unknown as SegmentRoute];
            expect(fromSaved(saved)?.[0].routes).toBeUndefined();
        }
    });
});
