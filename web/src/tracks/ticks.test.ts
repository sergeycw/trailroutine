import { describe, expect, it } from 'vitest';
import { distance } from './geometry';
import type { LatLng, Track } from './model';
import { minTickInterval, segmentTicks, tickLabel, tickStep, ticksData } from './ticks';

// A segment to the east from 41.69, 44.78, meters long on a great circle (along the parallel, accurate to
// centimeters)
function eastward(meters: number, points = 2): LatLng[] {
    const start = { lat: 41.69, lng: 44.78 };
    const perDegree = distance(start, { lat: 41.69, lng: 45.78 });
    return Array.from({ length: points }, (_, i) => ({
        lat: 41.69,
        lng: 44.78 + ((meters / perDegree) * i) / (points - 1),
    }));
}

const labels = (points: LatLng[], minInterval: number) =>
    segmentTicks(points, minInterval).map((tick) => tickLabel(tick.distance));

describe('шаг отметок', () => {
    it('15 мм экрана в метрах: формула старого клиента', () => {
        // z14 MapLibre = z15 of the old client: 2 × 20003931 / (256 × 2^15) m per pixel, 15 mm at 96 dpi
        const metersPerPixel = (2 * 20003931) / (512 * 2 ** 14);
        expect(minTickInterval(14, 0)).toBeCloseTo((0.015 / (0.0254 / 96)) * metersPerPixel, 6);
        expect(minTickInterval(14, 60)).toBeCloseTo(minTickInterval(14, 0) / 2, 6);
    });

    it.each([
        [100, 500],
        [500, 500],
        [501, 1000],
        [3000, 5000],
        [5_000_000, 1_000_000],
    ])('интервал %d м — шаг %d м', (interval, step) => {
        expect(tickStep(interval)).toBe(step);
    });
});

describe('Отметки расстояния', () => {
    it('Отметки на отрезке', () => {
        expect(labels(eastward(2300, 5), 400)).toEqual(['0.5 km', '1 km', '1.5 km', '2 km', '0 km', '2.3 km']);
    });

    it('отметка ближе половины 15 мм к концу убирается', () => {
        expect(labels(eastward(2100), 400)).toEqual(['0.5 km', '1 km', '1.5 km', '0 km', '2.1 km']);
    });

    it('короткий отрезок — без нулевой отметки', () => {
        expect(labels(eastward(150), 400)).toEqual(['0.15 km']);
    });

    it('Зум меняет шаг', () => {
        const line = eastward(20_000, 3);
        const near = labels(line, minTickInterval(14, 41.69));
        const far = labels(line, minTickInterval(10, 41.69));
        expect(near.length).toBeGreaterThan(far.length);
        expect(far).toEqual(['5 km', '10 km', '15 km', '0 km', '20 km']);
    });

    it('отметка — по прямой между узлами, подпись поперёк линии', () => {
        const [tick] = segmentTicks(eastward(1000), 400);
        expect(tick.distance).toBe(500);
        expect(tick.lat).toBeCloseTo(41.69, 9);
        // a line to the east: the label is rotated by 90°; to the north: horizontal
        expect(tick.rotate).toBeCloseTo(90, 6);
        const north = segmentTicks(
            [
                { lat: 41.69, lng: 44.78 },
                { lat: 41.7, lng: 44.78 },
            ],
            400,
        );
        expect(north[0].rotate).toBeCloseTo(0, 6);
        // to the west: it also reads from bottom to top, not upside down
        const west = segmentTicks(
            [
                { lat: 41.69, lng: 44.79 },
                { lat: 41.69, lng: 44.78 },
            ],
            400,
        );
        expect(west[0].rotate).toBeCloseTo(-90, 6);
    });
});

function track(fields: Partial<Track>): Track {
    return {
        id: 't',
        name: 'Ruler',
        segments: [eastward(2300, 5)],
        points: [],
        color: 0,
        visible: true,
        measureTicksShown: true,
        ...fields,
    };
}

describe('источник отметок', () => {
    it('только видимые треки с отметками, все отрезки', () => {
        const data = ticksData(
            [
                track({ id: 'a', segments: [eastward(2300, 5), eastward(700)] }),
                track({ id: 'b', measureTicksShown: false }),
                track({ id: 'c', visible: false }),
            ],
            14,
        );
        expect(data.features.map((feature) => feature.properties?.label)).toEqual([
            '0.5 km',
            '1 km',
            '1.5 km',
            '2 km',
            '0 km',
            '2.3 km',
            '0.5 km',
            '0 km',
            '0.7 km',
        ]);
    });
});
