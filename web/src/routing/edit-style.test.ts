import type { FeatureCollection, LineString, Point } from 'geojson';
import { describe, expect, test } from 'vitest';
import type { RouteEditState } from '@/state/store';
import { TRACK_COLORS, type Track } from '@/tracks/model';
import { segmentPieces, TRACK_LINES, TRACK_UNROUTED, trackSources } from '@/tracks/style';
import { EDIT_LEGS, EDIT_WAYPOINTS, editSources, previewData } from './edit-style';
import { type RouteLine, toSegment } from './line';

// Drawing of the route markup (specs route-editing «Разрыв со спиннером на ожидающем отрезке» and routing
// «Ошибка прокладки»): which line parts are drawn, where the dashes and the spinners are.

const P = (lat: number, lng: number) => ({ lat, lng });
const A = P(1, 1);
const R = P(1.5, 1.2);
const B = P(2, 2);
const C = P(3, 3);
const D = P(4, 4);

// A ─routed(R)─ B ─pending─ C ─failed─ D
const LINE: RouteLine = {
    waypoints: [A, B, C, D],
    legs: [
        { state: 'routed', activity: 'mtb', points: [R] },
        { state: 'pending', activity: 'mtb', request: 1 },
        { state: 'failed', activity: 'mtb' },
    ],
};

function data<T extends LineString | Point>(source: unknown) {
    return (source as { data: FeatureCollection<T> }).data.features;
}

describe('отрезок трека с разметкой', () => {
    test('Ожидание маршрута: разрыв; непроложенный — пунктиром', () => {
        const { points, route } = toSegment(LINE);
        const pieces = segmentPieces(points, route);
        expect(pieces.lines).toEqual([[A, R, B]]);
        expect(pieces.unrouted).toEqual([[C, D]]);
    });

    test('без разметки — одна линия', () => {
        expect(segmentPieces([A, B, C], null)).toEqual({ lines: [[A, B, C]], unrouted: [] });
    });

    test('источники треков: куски по отрезкам, редактируемый отрезок пропущен', () => {
        const { points, route } = toSegment(LINE);
        const track: Track = {
            id: 't',
            name: 'T',
            color: 0,
            visible: true,
            measureTicksShown: false,
            segments: [points, [C, D]],
            routes: [route, null],
            points: [],
        };
        const all = trackSources([track]);
        expect(data<LineString>(all.sources[TRACK_LINES]).map((f) => f.properties)).toEqual([
            { id: 't', segment: 0, color: TRACK_COLORS[0] },
            { id: 't', segment: 1, color: TRACK_COLORS[0] },
        ]);
        expect(data<LineString>(all.sources[TRACK_UNROUTED])).toHaveLength(1);
        const editing = trackSources([track], { trackId: 't', segment: 0 });
        expect(data<LineString>(editing.sources[TRACK_LINES]).map((f) => f.properties?.segment)).toEqual([1]);
        expect(data<LineString>(editing.sources[TRACK_UNROUTED])).toHaveLength(0);
    });

    test('отрезок из одной точки не рисуется', () => {
        const track: Track = {
            id: 't',
            name: 'T',
            color: 0,
            visible: true,
            measureTicksShown: false,
            segments: [[A], []],
            points: [],
        };
        expect(data<LineString>(trackSources([track]).sources[TRACK_LINES])).toEqual([]);
    });
});

describe('редактируемая линия', () => {
    const edit: RouteEditState = {
        trackId: 't',
        segment: 0,
        line: LINE,
        drawing: null,
        canUndo: false,
        canRedo: false,
        revision: 0,
    };

    test('ожидающий отрезок не рисуется, непроложенный помечен; начало и конец отмечены', () => {
        const sources = editSources(edit, TRACK_COLORS[0], null);
        expect(data<LineString>(sources[EDIT_LEGS]).map((f) => f.properties)).toEqual([
            { leg: 0, state: 'routed', color: TRACK_COLORS[0], unrouted: false },
            { leg: 2, state: 'failed', color: TRACK_COLORS[0], unrouted: true },
        ]);
        expect(data<Point>(sources[EDIT_WAYPOINTS]).map((f) => f.properties?.role)).toEqual([
            'start',
            'middle',
            'middle',
            'end',
        ]);
    });

    test('перетаскивание: точку и её отрезки рисует превью, а не источники линии', () => {
        const sources = editSources(edit, TRACK_COLORS[0], 1);
        expect(data<LineString>(sources[EDIT_LEGS]).map((f) => f.properties?.leg)).toEqual([2]);
        expect(data<Point>(sources[EDIT_WAYPOINTS]).map((f) => f.properties?.index)).toEqual([0, 2, 3]);
        const preview = previewData([[A, P(2.2, 2.2), C]], TRACK_COLORS[0], { latlng: P(2.2, 2.2), role: 'middle' });
        expect(preview.features.map((f) => f.geometry.type)).toEqual(['LineString', 'Point']);
    });

    test('без редактирования источники пустые', () => {
        const sources = editSources(null, '', null);
        expect(Object.values(sources).every((source) => data(source).length === 0)).toBe(true);
    });
});
