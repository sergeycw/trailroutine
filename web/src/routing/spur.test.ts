import { describe, expect, test } from 'vitest';
import { distance } from '@/tracks/geometry';
import type { LatLng } from '@/tracks/model';
import { parseRoute } from './brouter';
import { type Leg, linePoints, type RouteLine, STRAIGHT } from './line';
import { SPUR_LIMIT, trimSpur } from './spur';

// Scenarios of the requirement «Опорная точка у поворота» (spec route-editing) on a line without a map and a router.

// A public BRouter response (profile hiking-mountain, 2026-11-02): Strelna, the crossroads of Tselinnaya Street and
// Grazhdansky Lane, the waypoint W 8 m past the crossroads along Tselinnaya; coordinates are [lng, lat], as in GeoJSON
const STRELNA = {
    A: { lat: 59.8465, lng: 30.0286 },
    W: { lat: 59.845338, lng: 30.028319 },
    B: { lat: 59.844763, lng: 30.027651 },
    junction: { lat: 59.84537, lng: 30.02819 },
    toW: [
        [30.02855, 59.846503],
        [30.028507, 59.846392],
        [30.028281, 59.845976],
        [30.028207, 59.845714],
        [30.02819, 59.84537],
        [30.028319, 59.845338],
    ],
    fromW: [
        [30.028319, 59.845338],
        [30.02819, 59.84537],
        [30.028009, 59.845084],
        [30.027757, 59.844824],
        [30.027651, 59.844763],
    ],
};

const geojson = (coordinates: number[][]) =>
    JSON.stringify({ features: [{ geometry: { type: 'LineString', coordinates } }] });

const routed = (points: LatLng[]): Leg => ({ state: 'routed', activity: 'hiking', points });

// A point in meters east (x) and north (y) of the coordinate origin at the crossroads in Strelna
const ORIGIN = STRELNA.junction;
const M = (x: number, y: number): LatLng => ({
    lat: ORIGIN.lat + y / 111195,
    lng: ORIGIN.lng + x / (111195 * Math.cos((ORIGIN.lat * Math.PI) / 180)),
});

function line(waypoints: LatLng[], legs: Leg[]): RouteLine {
    return { waypoints, legs };
}

describe('Опорная точка у поворота', () => {
    test('Точка чуть дальше перекрёстка', () => {
        const { A, W, B, junction } = STRELNA;
        const before = line(
            [A, W, B],
            [routed(parseRoute(geojson(STRELNA.toW), A, W)), routed(parseRoute(geojson(STRELNA.fromW), W, B))],
        );
        // without the trim, the line goes crossroads → W → crossroads
        expect(linePoints(before).filter((p) => distance(p, junction) < 0.5)).toHaveLength(2);

        const after = trimSpur(before, 1);

        expect(after?.waypoints[1]).toEqual(junction);
        const points = linePoints(after as RouteLine);
        expect(points.filter((p) => distance(p, junction) < 0.5)).toHaveLength(1);
        expect(points.some((p) => distance(p, W) < 1)).toBe(false);
        // the ends and the activity of the legs do not change
        expect(after?.waypoints[0]).toBe(A);
        expect(after?.waypoints[2]).toBe(B);
        expect(after?.legs.every((leg) => leg.state === 'routed' && leg.activity === 'hiking')).toBe(true);
    });

    test('Перекрёсток, выкинутый упрощением', () => {
        // there: straight along the street through the crossroads (the leg has no node for it), back: a turn south at
        // the crossroads
        const W = M(8, 0);
        const result = trimSpur(
            line([M(-200, 0), W, M(0, -200)], [routed([M(-100, 0)]), routed([M(0, 0), M(0, -100)])]),
            1,
        );

        expect(distance(result?.waypoints[1] as LatLng, M(0, 0))).toBeLessThan(0.01);
        expect(result?.legs[0]).toEqual(routed([M(-100, 0)]));
        expect(result?.legs[1]).toEqual(routed([M(0, -100)]));
    });

    test('Заход к вершине остаётся', () => {
        // a trail from the crossroads 200 m north to a summit and back along the same trail
        const trail = [M(0, 0), M(0, 50), M(0, 100), M(0, 150)];
        const spur = line([M(-200, 0), M(0, 200), M(200, 0)], [routed(trail), routed([...trail].reverse())]);

        expect(trimSpur(spur, 1)).toBeNull();
    });

    test('Ус длиннее порога остаётся', () => {
        const W = M(SPUR_LIMIT + 5, 0);
        expect(
            trimSpur(line([M(-200, 0), W, M(0, -200)], [routed([M(0, 0)]), routed([M(0, 0), M(0, -100)])]), 1),
        ).toBeNull();
    });

    test('Прямой соседний отрезок', () => {
        const { A, W, B } = STRELNA;
        const straight = line([A, W, B], [routed(parseRoute(geojson(STRELNA.toW), A, W)), STRAIGHT]);

        expect(trimSpur(straight, 1)).toBeNull();
        expect(trimSpur(straight, 0)).toBeNull();
        expect(trimSpur(straight, 2)).toBeNull();
    });

    test('Поворот в самой опорной точке', () => {
        // the point is exactly at the crossroads: the route came from the west and went south, there is no spur
        expect(
            trimSpur(line([M(-200, 0), M(0, 0), M(0, -200)], [routed([M(-100, 0)]), routed([M(0, -100)])]), 1),
        ).toBeNull();
    });

    test('Возврат по всему отрезку', () => {
        // the leg there is 20 m along the street, back along the same street past the start: not a spur but a U-turn on
        // the whole leg
        expect(
            trimSpur(line([M(0, 0), M(20, 0), M(-200, 0)], [routed([M(10, 0)]), routed([M(10, 0), M(-100, 0)])]), 1),
        ).toBeNull();
    });

    test('Непроложенный соседний отрезок', () => {
        const { A, W, B } = STRELNA;
        const failed = line(
            [A, W, B],
            [routed(parseRoute(geojson(STRELNA.toW), A, W)), { state: 'failed', activity: 'hiking' }],
        );

        expect(trimSpur(failed, 1)).toBeNull();
    });

    test('Точка в стороне от дороги', () => {
        // a point 25 m from the road: BRouter snapped it to the road at P, the line goes P → point → P, the same spur
        const P = M(0, 0);
        const result = trimSpur(
            line([M(-200, 0), M(0, 25), M(200, 0)], [routed([M(-100, 0), P]), routed([P, M(100, 0)])]),
            1,
        );

        expect(result?.waypoints[1]).toBe(P);
        expect(result?.legs).toEqual([routed([M(-100, 0)]), routed([M(100, 0)])]);
    });

    test('Точка далеко от дороги остаётся', () => {
        const P = M(0, 0);
        expect(
            trimSpur(line([M(-200, 0), M(0, 40), M(200, 0)], [routed([M(-100, 0), P]), routed([P, M(100, 0)])]), 1),
        ).toBeNull();
    });

    test('Маршрут насквозь с изломом у точки', () => {
        // came from the west, went east; a road bend 2.5 m from the point is not a turn back
        expect(
            trimSpur(
                line([M(-200, 5), M(0, 0), M(200, 0)], [routed([M(-100, 5), M(-2.5, 0.5)]), routed([M(100, 0)])]),
                1,
            ),
        ).toBeNull();
    });

    test('Вершина серпантина', () => {
        // the switchback branches leave the point at the apex at 30°, the branch nodes are at 10 m: there the branches
        // are already more than 3 m apart
        const branch = (degrees: number, r: number) =>
            M(r * Math.sin((degrees * Math.PI) / 180), -r * Math.cos((degrees * Math.PI) / 180));
        expect(
            trimSpur(
                line(
                    [branch(-15, 200), M(0, 0), branch(15, 200)],
                    [routed([branch(-15, 100), branch(-15, 10)]), routed([branch(15, 10), branch(15, 100)])],
                ),
                1,
            ),
        ).toBeNull();
    });
});
