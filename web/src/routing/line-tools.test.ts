import { describe, expect, test } from 'vitest';
import type { LatLng } from '@/tracks/model';
import { fromSegment, type Leg, linePoints, type RouteLine, routeFits, simplifyRouted, toSegment } from './line';
import { cutLine, joinLines, reverseLine, shortcutLine, shortcutRemoved, splitLeg } from './line-tools';

// Line tool operations on the model without a map (spec route-editing: «Разрез отрезка», «Склейка отрезков»,
// «Срез участка», «Разворот отрезка», «Разметка маршрута после правки линии»).

const P = (lat: number, lng: number) => ({ lat, lng });
const A = P(41.69, 44.78);
const R1 = P(41.692, 44.783);
const R2 = P(41.695, 44.786);
const B = P(41.7, 44.79);
const C = P(41.71, 44.8);
const D = P(41.72, 44.79);
const E = P(41.73, 44.8);

const hiking = (points: LatLng[]): Leg => ({ state: 'routed', activity: 'hiking', points });
const STRAIGHT: Leg = { state: 'straight' };

// A ─(hiking: R1, R2)─ B ── C ─(mtb, not routed)─ D
const LINE: RouteLine = {
    waypoints: [A, B, C, D],
    legs: [hiking([R1, R2]), STRAIGHT, { state: 'failed', activity: 'mtb' }],
};

// a part markup after the operation is valid, and the simplification for an nktk link does not touch the waypoints
function expectSound(line: RouteLine) {
    const { points, route } = toSegment(line);
    if (route) {
        expect(routeFits(points, route)).toBe(true);
        const simplified = simplifyRouted(points, route);
        expect(simplified && fromSegment(simplified.points, simplified.route).waypoints).toEqual(line.waypoints);
    }
    expect(fromSegment(points, route)).toEqual(line);
}

describe('splitLeg', () => {
    test('посреди маршрута: опорная точка на звене, обе половины проложены, геометрия та же', () => {
        // nearest to the link R1–R2
        const split = splitLeg(LINE, 0, P(41.6935, 44.7843));
        expect(split?.index).toBe(1);
        const line = split?.line as RouteLine;
        const at = line.waypoints[1];
        expect(line.legs[0]).toEqual(hiking([R1]));
        expect(line.legs[1]).toEqual(hiking([R2]));
        expect(linePoints(line)).toEqual([A, R1, at, R2, B, C, D]);
        expectSound(line);
    });

    test('прямой и непроложенный отрезки делятся на две копии', () => {
        const straight = splitLeg(LINE, 1, P(41.705, 44.795))?.line as RouteLine;
        expect(straight.legs.slice(1, 3)).toEqual([STRAIGHT, STRAIGHT]);
        const failed = splitLeg(LINE, 2, P(41.715, 44.795))?.line as RouteLine;
        expect(failed.legs.slice(2)).toEqual([LINE.legs[2], LINE.legs[2]]);
    });

    test('нет такого отрезка — null', () => {
        expect(splitLeg(LINE, 3, A)).toBeNull();
    });
});

describe('Разрез отрезка', () => {
    test('Разрез в опорной точке', () => {
        const [first, second] = cutLine(LINE, { waypoint: 1 }) as [RouteLine, RouteLine];
        expect(first).toEqual({ waypoints: [A, B], legs: [hiking([R1, R2])] });
        expect(second).toEqual({ waypoints: [B, C, D], legs: [STRAIGHT, LINE.legs[2]] });
        expectSound(first);
        expectSound(second);
    });

    test('Разрез посреди маршрута: точка разреза — конец обоих отрезков, обе половины проложены', () => {
        const [first, second] = cutLine(LINE, { leg: 0, latlng: P(41.6935, 44.7843) }) as [RouteLine, RouteLine];
        const at = first.waypoints[1];
        expect(second.waypoints[0]).toBe(at);
        expect(first.legs).toEqual([hiking([R1])]);
        expect(second.legs[0]).toEqual(hiking([R2]));
        expect([...linePoints(first), ...linePoints(second).slice(1)]).toEqual(
            linePoints(splitLeg(LINE, 0, at)?.line as RouteLine),
        );
        expectSound(first);
        expectSound(second);
    });

    test('в крайней опорной точке резать нечего', () => {
        expect(cutLine(LINE, { waypoint: 0 })).toBeNull();
        expect(cutLine(LINE, { waypoint: 3 })).toBeNull();
    });
});

describe('Разворот отрезка', () => {
    test('опорные точки, отрезки и точки маршрута — в обратном порядке', () => {
        const line = reverseLine(LINE);
        expect(line.waypoints).toEqual([D, C, B, A]);
        expect(line.legs).toEqual([LINE.legs[2], STRAIGHT, hiking([R2, R1])]);
        expect(linePoints(line)).toEqual(linePoints(LINE).reverse());
        expectSound(line);
    });
});

describe('Склейка отрезков', () => {
    const OTHER: RouteLine = { waypoints: [E, C], legs: [hiking([P(41.725, 44.81)])] };

    test('к концу — ближним началом: стык прямой', () => {
        const line = joinLines(LINE, 'end', OTHER, 'start');
        expect(line.waypoints).toEqual([A, B, C, D, E, C]);
        expect(line.legs).toEqual([...LINE.legs, STRAIGHT, OTHER.legs[0]]);
        expectSound(line);
    });

    test('к концу — ближним концом: другая линия разворачивается вместе с разметкой', () => {
        const line = joinLines(LINE, 'end', OTHER, 'end');
        expect(line.waypoints).toEqual([A, B, C, D, C, E]);
        expect(line.legs.at(-1)).toEqual(hiking([P(41.725, 44.81)]));
        expectSound(line);
    });

    test('к началу', () => {
        expect(joinLines(LINE, 'start', OTHER, 'end').waypoints).toEqual([E, C, A, B, C, D]);
        const reversed = joinLines(LINE, 'start', OTHER, 'start');
        expect(reversed.waypoints).toEqual([C, E, A, B, C, D]);
        expect(reversed.legs.slice(0, 2)).toEqual([OTHER.legs[0], STRAIGHT]);
        expectSound(reversed);
    });
});

describe('Срез участка', () => {
    test('Срезать петлю: между опорными точками — прямая, соседние отрезки сохраняют разметку', () => {
        const line = shortcutLine(LINE, { waypoint: 1 }, { waypoint: 3 }) as RouteLine;
        expect(line).toEqual({ waypoints: [A, B, D], legs: [hiking([R1, R2]), STRAIGHT] });
        expectSound(line);
    });

    test('порядок мест не важен', () => {
        expect(shortcutLine(LINE, { waypoint: 3 }, { waypoint: 1 })).toEqual(
            shortcutLine(LINE, { waypoint: 1 }, { waypoint: 3 }),
        );
    });

    test('Срез из середины маршрута: начало становится опорной точкой, до неё отрезок проложен', () => {
        const line = shortcutLine(LINE, { leg: 0, latlng: P(41.6935, 44.7843) }, { waypoint: 2 }) as RouteLine;
        expect(line.waypoints[0]).toBe(A);
        expect(line.waypoints.slice(2)).toEqual([C, D]);
        expect(line.legs).toEqual([hiking([R1]), STRAIGHT, LINE.legs[2]]);
        expectSound(line);
    });

    test('оба конца посреди отрезков', () => {
        const line = shortcutLine(LINE, { leg: 2, latlng: P(41.715, 44.795) }, { leg: 0, latlng: R1 }) as RouteLine;
        expect(line.waypoints).toHaveLength(4);
        expect(line.legs).toEqual([hiking([]), STRAIGHT, LINE.legs[2]]);
        expectSound(line);
    });

    test('оба места на одном проложенном отрезке, в любом порядке', () => {
        const R3 = P(41.697, 44.788);
        // A ─(hiking: R1, R2, R3)─ B; the first place is on the link A–R1, the second place is on the link R2–R3
        const long: RouteLine = { waypoints: [A, B], legs: [hiking([R1, R2, R3])] };
        const first = P(41.691, 44.7815);
        const second = P(41.6965, 44.7875);
        const line = shortcutLine(long, { leg: 0, latlng: first }, { leg: 0, latlng: second }) as RouteLine;
        expect(shortcutLine(long, { leg: 0, latlng: second }, { leg: 0, latlng: first })).toEqual(line);
        // A ─(route)─ X ── straight ── Y ─(route through R3)─ B
        expect(line.waypoints).toHaveLength(4);
        expect(line.legs).toEqual([hiking([]), STRAIGHT, hiking([R3])]);
        expect(shortcutRemoved(long, { leg: 0, latlng: first }, { leg: 0, latlng: second })?.slice(1, -1)).toEqual([
            R1,
            R2,
        ]);
        expectSound(line);
    });

    test('ожидающий отрезок делится на две копии с тем же запросом (новые запросы — дело редактора)', () => {
        const waiting: RouteLine = { waypoints: [A, B], legs: [{ state: 'pending', activity: 'mtb', request: 7 }] };
        const split = splitLeg(waiting, 0, P(41.695, 44.785))?.line as RouteLine;
        expect(split.legs).toEqual([waiting.legs[0], waiting.legs[0]]);
        const [first, second] = cutLine(waiting, { leg: 0, latlng: P(41.695, 44.785) }) as [RouteLine, RouteLine];
        // in a track, a pending leg without a live request is written as unrouted (settledRoute in editing.ts)
        expect(toSegment(first).route?.legs).toEqual([{ state: 'pending', activity: 'mtb' }]);
        expect(second.legs).toEqual([waiting.legs[0]]);
    });

    test('маршрут между соседними опорными точками заменяется прямой', () => {
        const line = shortcutLine(LINE, { waypoint: 0 }, { waypoint: 1 }) as RouteLine;
        expect(line.legs[0]).toEqual(STRAIGHT);
        expect(linePoints(line)).toEqual([A, B, C, D]);
    });

    test('удалять нечего — null: соседние точки прямой, одно звено, точка и её звено', () => {
        expect(shortcutLine(LINE, { waypoint: 1 }, { waypoint: 2 })).toBeNull();
        expect(shortcutLine(LINE, { leg: 1, latlng: B }, { leg: 1, latlng: C })).toBeNull();
        expect(shortcutLine(LINE, { waypoint: 1 }, { leg: 1, latlng: C })).toBeNull();
        expect(shortcutLine(LINE, { waypoint: 1 }, { waypoint: 1 })).toBeNull();
        expect(shortcutRemoved(LINE, { waypoint: 1 }, { waypoint: 2 })).toBeNull();
    });

    test('подсветка — удаляемый путь от места до места', () => {
        expect(shortcutRemoved(LINE, { waypoint: 0 }, { waypoint: 2 })).toEqual([A, R1, R2, B, C]);
        const removed = shortcutRemoved(LINE, { leg: 0, latlng: P(41.6935, 44.7843) }, { waypoint: 1 }) as LatLng[];
        expect(removed.slice(1)).toEqual([R2, B]);
    });
});
