import { describe, expect, test } from 'vitest';
import { distance } from '@/tracks/geometry';
import { type Activity, getActivity, parseRoute, RoutingError, routeQuery } from './brouter';

function activity(id: string): Activity {
    const found = getActivity(id);
    if (!found) {
        throw new Error(`no activity ${id}`);
    }
    return found;
}

// Scenarios of the spec routing («Активность задаёт профиль BRouter», «Форма полученного отрезка», «Ошибка прокладки»)
// without network: the BRouter response is GeoJSON as a string, as both the engine and the server return it.

// a degree of latitude in meters (R = 6 371 000 m, as in distance)
const DEG = (6371000 * Math.PI) / 180;

function geojson(coordinates: [number, number][]) {
    return JSON.stringify({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates } }] });
}

// a road with a bend in Tbilisi: the simplification does not collapse it
const ROAD: [number, number][] = [
    [44.78, 41.69],
    [44.785, 41.692],
    [44.79, 41.69],
];

describe('Активность задаёт профиль BRouter', () => {
    test('Пешком по тропам', () => {
        const query = new URLSearchParams(
            routeQuery({ lat: 41.69, lng: 44.78 }, { lat: 41.7, lng: 44.79 }, activity('hiking-trails')),
        );
        expect(query.get('profile')).toBe('hiking-mountain');
        expect(query.get('profile:path_preference')).toBe('20');
        expect(query.get('alternativeidx')).toBe('0');
        expect(query.get('format')).toBe('geojson');
        expect(query.get('lonlats')).toBe('44.780000,41.690000|44.790000,41.700000');
    });

    test('профили всех активностей', () => {
        const profiles = ['hiking', 'road-bike', 'gravel', 'mtb', 'touring-bike'].map((id) =>
            new URLSearchParams(routeQuery({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, activity(id))).get('profile'),
        );
        expect(profiles).toEqual(['hiking-mountain', 'fastbike', 'gravel', 'mtb', 'trekking']);
    });

    test('точка на соседней копии мира уходит в запрос приведённой', () => {
        const query = new URLSearchParams(
            routeQuery({ lat: 41.69, lng: 44.78 + 360 }, { lat: 41.7, lng: 44.79 + 360 }, activity('mtb')),
        );
        expect(query.get('lonlats')).toBe('44.780000,41.690000|44.790000,41.700000');
    });
});

describe('Форма полученного отрезка', () => {
    test('Опорная точка у дороги', () => {
        const from = { lat: 41.69 + 5 / DEG, lng: 44.78 };
        const to = { lat: 41.69 + 5 / DEG, lng: 44.79 };
        expect(distance(from, { lat: 41.69, lng: 44.78 })).toBeLessThan(20);
        const nodes = parseRoute(geojson(ROAD), from, to);
        // both road ends are nearer than 20 m to their waypoints: the line goes from the waypoint directly to the bend
        expect(nodes).toEqual([{ lat: 41.692, lng: 44.785 }]);
    });

    test('Опорная точка далеко от дороги', () => {
        const from = { lat: 41.69 + 200 / DEG, lng: 44.78 };
        const to = { lat: 41.69, lng: 44.79 };
        const nodes = parseRoute(geojson(ROAD), from, to);
        // from a far waypoint to the road a straight piece stays: the first road point is in its place
        expect(nodes[0]).toEqual({ lat: 41.69, lng: 44.78 });
        expect(nodes).toHaveLength(2);
    });

    test('лишние точки на прямой упрощаются', () => {
        const straight: [number, number][] = [
            [44.78, 41.69],
            [44.7825, 41.69],
            [44.785, 41.69],
            [44.7875, 41.69],
            [44.79, 41.69],
        ];
        const nodes = parseRoute(geojson(straight), { lat: 41.7, lng: 44.78 }, { lat: 41.7, lng: 44.79 });
        expect(nodes).toEqual([
            { lat: 41.69, lng: 44.78 },
            { lat: 41.69, lng: 44.79 },
        ]);
    });

    test('ответ сдвигается в копию мира опорной точки', () => {
        const from = { lat: 41.7, lng: 44.78 + 360 };
        const nodes = parseRoute(geojson(ROAD), from, { lat: 41.7, lng: 44.79 + 360 });
        expect(nodes.map((point) => point.lng)).toEqual([44.78 + 360, 44.785 + 360, 44.79 + 360]);
    });
});

describe('Ошибка прокладки', () => {
    test('Район без данных', () => {
        const error = new RoutingError('datafile E30_N55.rd5 not found');
        expect(error.message).toBe('no routing data for this area');
        expect(error.unreachable).toBe(false);
    });

    test('пустой маршрут — ошибка «no route found»', () => {
        const from = { lat: 41.69, lng: 44.78 };
        expect(() => parseRoute(geojson([]), from, from)).toThrow('no route found');
        expect(() => parseRoute(geojson([[44.78, 41.69]]), from, from)).toThrow('no route found');
        expect(() => parseRoute('{"type":"FeatureCollection","features":[]}', from, from)).toThrow('no route found');
    });

    test('не JSON', () => {
        expect(() => parseRoute('<html>', { lat: 0, lng: 0 }, { lat: 0, lng: 0 })).toThrow(RoutingError);
    });
});
