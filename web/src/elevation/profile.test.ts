import { describe, expect, it } from 'vitest';
import { distance } from '@/tracks/geometry';
import { cursorInfo } from './format';
import {
    distanceAt,
    elevationAt,
    gridValues,
    indexAtDistance,
    nearestIndex,
    pointAt,
    profileStats,
    sampleSegments,
    samplingInterval,
    sectionAt,
    sectionLength,
    simplifyProfile,
    slopeClass,
    slopeSections,
} from './profile';

const P = (lat: number, lng: number) => ({ lat, lng });
// a profile with points every 100 m on one segment: for the summary only the distances and the segments matter
const even = (n: number, step = 100, starts = [0]) => ({
    distances: Float64Array.from({ length: n }, (_, i) => i * step),
    starts,
});

describe('samplingInterval', () => {
    // the numbers are from calcSamplingInterval of the old client on the same lengths
    it('шаг 10–50 м и не больше 9 999 точек', () => {
        expect(samplingInterval(1000)).toBe(10);
        expect(samplingInterval(50_000)).toBe(25);
        expect(samplingInterval(1_000_000)).toBeCloseTo(1_000_000 / 9999, 9);
    });
});

describe('sampleSegments', () => {
    const line = [P(41.7, 44.78), P(41.709, 44.78)];
    const length = distance(line[0], line[1]);

    it('конец отрезка входит, даже если хвост короче шага', () => {
        const profile = sampleSegments([line], 100);
        expect(length).toBeGreaterThan(1000);
        expect(profile.points).toHaveLength(12);
        expect(profile.points.at(-1)).toEqual(line[1]);
        expect(profile.distances.at(-1)).toBeCloseTo(length, 6);
        expect(profile.distances[10]).toBeCloseTo(1000, 6);
        expect(profile.length).toBeCloseTo(length, 6);
    });

    it('точки на линии через шаг', () => {
        const profile = sampleSegments([line], 100);
        expect(profile.points[5].lng).toBe(44.78);
        expect(distance(line[0], profile.points[5])).toBeCloseTo(500, 3);
    });

    it('стык отрезков не добавляет расстояния', () => {
        const far = [P(41.75, 44.78), P(41.759, 44.78)];
        const profile = sampleSegments([line, far], 100);
        expect(profile.starts).toEqual([0, 12]);
        expect(profile.distances[12]).toBeCloseTo(profile.distances[11], 9);
        expect(profile.length).toBeCloseTo(2 * length, 3);
    });

    it('отрезок нулевой длины пропускается', () => {
        const profile = sampleSegments([[P(41, 44), P(41, 44)], line], 100);
        expect(profile.starts).toEqual([0]);
        expect(profile.points[0]).toEqual(line[0]);
    });

    it('начала и концы отрезков не выводят выборку за 10 000 точек (один запрос)', () => {
        // ≈ 600 km: the samplingInterval step gives 9 999 points, and each segment adds up to two more
        for (const count of [2, 10, 100]) {
            const segments = Array.from({ length: count }, (_, k) => [
                P(40 + k * 0.01, 40),
                P(40 + k * 0.01 + 5.4 / count, 40),
            ]);
            expect(sampleSegments(segments).points.length).toBeLessThanOrEqual(10000);
        }
    });

    it('шаг по умолчанию — samplingInterval длины', () => {
        const profile = sampleSegments([line]);
        expect(profile.distances[1]).toBe(samplingInterval(length));
    });
});

describe('profileStats', () => {
    it('Подъём и спуск', () => {
        const stats = profileStats(even(3), [100, 200, 150]);
        expect(stats).toMatchObject({ ascent: 100, descent: 50, min: 100, max: 200, start: 100, end: 150 });
        expect(stats.distance).toBe(200);
    });

    it('Мелкие колебания', () => {
        const stats = profileStats(even(5), [100, 103, 100, 103, 100]);
        expect(stats.ascent).toBe(0);
        expect(stats.descent).toBe(0);
    });

    it('последняя точка с данными входит в набор (у старого срез её терял)', () => {
        expect(profileStats(even(4), [100, 100, 100, 150]).ascent).toBe(50);
    });

    it('Точки без данных: шкала без нуля, пометки, разрыв заполняется прямой', () => {
        const stats = profileStats(even(5), [null, 100, null, 200, null]);
        expect(stats).toMatchObject({ min: 100, max: 200, ascent: 100, missing: true, approxStart: true });
        expect(stats.approxEnd).toBe(true);
    });

    it('ни одной точки с данными', () => {
        expect(profileStats(even(3), [null, null, null])).toMatchObject({ noData: true, missing: true });
    });

    it('стык отрезков не считается подъёмом и не даёт уклона', () => {
        const stats = profileStats(even(4, 100, [0, 2]), [100, 100, 300, 300]);
        expect(stats).toMatchObject({ ascent: 0, descent: 0, start: 100, end: 300, ascentAngle: null });
    });

    it('уклоны — средний и наибольший по расстоянию', () => {
        const stats = profileStats(even(4), [0, 100, 110, 50]);
        expect(stats.ascentAngle).toEqual({ avg: 29, max: 45 });
        expect(stats.descentAngle).toEqual({ avg: 31, max: 31 });
    });

    it('сводка участка', () => {
        const stats = profileStats(even(5), [100, 200, 300, 200, 100], 1, 3);
        expect(stats).toMatchObject({ distance: 200, start: 200, end: 200, ascent: 100, descent: 100, max: 300 });
    });
});

describe('simplifyProfile', () => {
    it('оставляет изломы больше допуска, по расстоянию', () => {
        expect(simplifyProfile([0, 10, 20, 1000], [0, 100, 0, 0], 5)).toEqual([0, 1, 2, 3]);
        expect(simplifyProfile([0, 10, 20], [0, 4, 0], 5)).toEqual([0, 2]);
    });
});

describe('gridValues', () => {
    it('3–5 круглых значений вокруг диапазона, как calcGridValues старого', () => {
        expect(gridValues(100, 200)).toEqual([100, 150, 200]);
        expect(gridValues(1230, 2080)).toEqual([1000, 1500, 2000, 2500]);
        expect(gridValues(100, 100)).toEqual([100, 101, 102]);
    });
});

describe('курсор', () => {
    const points = [P(0, 0), P(0, 1), P(0, 2)];
    const distances = Float64Array.from([0, 100, 150]);

    it('точка и расстояние по дробному номеру', () => {
        expect(pointAt(points, 1.5)).toEqual(P(0, 1.5));
        expect(pointAt(points, 5)).toEqual(P(0, 2));
        expect(distanceAt(distances, 1.5)).toBe(125);
    });

    it('номер по расстоянию', () => {
        expect(indexAtDistance(distances, 50)).toBe(0.5);
        expect(indexAtDistance(distances, 125)).toBe(1.5);
        expect(indexAtDistance(distances, 1000)).toBe(2);
    });

    it('высота у курсора', () => {
        expect(elevationAt([100, null, 200], 0.8)).toBe(100);
        expect(elevationAt([100, null, 200], 1.2)).toBe(200);
        expect(elevationAt([100, null, 200], 1)).toBeNull();
    });

    it('ближайшее место на линии на экране, без звена через стык', () => {
        const screen = [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 200, y: 100 },
        ];
        expect(nearestIndex(screen, [0], { x: 50, y: 3 }, 10)).toBe(0.5);
        expect(nearestIndex(screen, [0], { x: 50, y: 30 }, 10)).toBeNull();
        expect(nearestIndex(screen, [0, 1], { x: 50, y: 3 }, 10)).toBeNull();
        expect(nearestIndex(screen, [0], { x: 201, y: 101 }, 10)).toBe(2);
    });
});

describe('Участки крутизны', () => {
    // 1 km every 100 m: the first half is flat at 800 m, the second half climbs 100 m (20 %)
    const flatThenClimb = [800, 800, 800, 800, 800, 800, 820, 840, 860, 880, 900];
    const span = (sections: { from: number; to: number }[]) => sections.map(({ from, to }) => [from, to]);

    it('Участки разной крутизны', () => {
        const sections = slopeSections(even(11), flatThenClimb);
        expect(span(sections)).toEqual(Array.from({ length: 10 }, (_, i) => [i, i + 1]));
        expect(sections.map((section) => slopeClass(section.grade))).toEqual([0, 0, 0, 0, 0, 4, 4, 4, 4, 4]);
        expect(sections[9].grade).toBeCloseTo(20, 9);
    });

    it('Короткий хвост участка', () => {
        const profile = { distances: Float64Array.from([0, 50, 100, 150, 200, 240]), starts: [0] };
        expect(span(slopeSections(profile, [0, 0, 0, 0, 0, 0], 100))).toEqual([
            [0, 2],
            [2, 5],
        ]);
        // a tail not shorter than half of a section is a separate section
        const longTail = { distances: Float64Array.from([0, 100, 160]), starts: [0] };
        expect(span(slopeSections(longTail, [0, 0, 0], 100))).toEqual([
            [0, 1],
            [1, 2],
        ]);
    });

    it('участки рвутся на точках без данных и на стыке отрезков', () => {
        expect(span(slopeSections(even(5), [0, 10, null, 0, 10], 100))).toEqual([
            [0, 1],
            [3, 4],
        ]);
        expect(span(slopeSections(even(4, 100, [0, 2]), [0, 10, 20, 30], 100))).toEqual([
            [0, 1],
            [2, 3],
        ]);
        // a run shorter than a section gives one section, a single point gives none
        expect(span(slopeSections(even(3), [0, 5, null], 1000))).toEqual([[0, 1]]);
        expect(slopeSections(even(3), [null, 5, null], 100)).toEqual([]);
    });

    it('длина участка — не меньше 100 м и 1/200 профиля', () => {
        expect(sectionLength(1000)).toBe(100);
        expect(sectionLength(100_000)).toBe(500);
    });

    it('ступень — по модулю уклона, округлённого до целого', () => {
        expect([0, 2.4, 2.6, -2.6, -2.5, 5.6, 6, -12, 15, 24.4, 24.6, 100].map(slopeClass)).toEqual([
            0, 0, 1, 1, 1, 2, 2, 3, 4, 4, 5, 5,
        ]);
    });

    it('участок под курсором', () => {
        const sections = slopeSections(even(11), flatThenClimb);
        expect(sectionAt(sections, 0.5)).toBe(sections[0]);
        // the shared point of two sections gives the next one, the end of a run gives the last one
        expect(sectionAt(sections, 5)).toBe(sections[5]);
        expect(sectionAt(sections, 10)).toBe(sections[9]);
        const gapped = slopeSections(even(5), [0, 10, null, 0, 10], 100);
        expect(sectionAt(gapped, 1)).toBe(gapped[0]);
        expect(sectionAt(gapped, 2.5)).toBeNull();
        expect(sectionAt(gapped, 3)).toBe(gapped[1]);
    });
});

describe('уклон у курсора', () => {
    it('модуль округляется как ступень: −2.5 % — «↓ 3%», ступень 3–6', () => {
        // a descent of 3 m on 120 m: −2.5 %
        const samples = { points: [], distances: Float64Array.from([0, 120]), starts: [0], length: 120 };
        const data = { samples, values: [100, 97], updating: false, error: null };
        expect(cursorInfo(data, 0.5).slope).toBe('↓ 3%');
        expect(cursorInfo({ ...data, values: [100, 100] }, 0.5).slope).toBe('0%');
        expect(cursorInfo({ ...data, values: [100, null] }, 0.5).slope).toBe('-');
    });
});
