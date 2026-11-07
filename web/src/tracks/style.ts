import type { Feature, LineString, Point } from 'geojson';
import type {
    ExpressionSpecification,
    GeoJSONSourceSpecification,
    LayerSpecification,
    LineLayerSpecification,
} from 'maplibre-gl';
import type { SegmentRoute } from '@/routing/line';
import { type LatLng, type Track, trackColor } from './model';

// Tracks on the map (design add-web-tracks, «Треки на карте»): GeoJSON sources for all tracks, above all layers.
// The line is opaque in the track color over a white casing (design map-chrome): the semi-transparent line of the old
// client (weight 6, opacity 0.5) was lost on satellite imagery and the Strava heatmap. MapLibre draws point labels
// itself, without glyphs in the style: the font from text-font is a CSS family (GlyphManager MapLibre 6). The ids of
// sources and layers do not overlap with the codes of catalog layers and custom layers (-cs…).
//
// A line feature is a piece of one track segment (the track id and the segment index are in the properties: a click
// starts editing by them).
// Route markup cuts a segment into pieces (design add-web-route-editor, «Отрисовка»): a pending leg is a gap without a
// marker, an unrouted leg is a red dashed line in the tracks-unrouted layer instead of the track line.
// The editor draws the segment in editing (routing/edit-style.ts), it is not here.

export const TRACK_LINES = 'tracks';
// line casing: the same source, a layer under the lines; clicks look only for TRACK_LINES (MapEditor)
export const TRACK_CASING = 'tracks-casing';
export const TRACK_UNROUTED = 'tracks-unrouted';
// casing of the dashed line of an unrouted leg: on satellite imagery, the error mark must not be harder to see than
// the track line
export const TRACK_UNROUTED_CASING = 'tracks-unrouted-casing';
export const TRACK_POINTS = 'track-points';
export const TRACK_LABELS = 'track-labels';
// distance ticks (tracks/ticks.ts): the map builds the source at an integer zoom
export const TRACK_TICKS = 'track-ticks';

// mark of an unrouted leg (the owner's decision 2026-10-09: a red dashed line always, also outside editing)
export const UNROUTED_COLOR = '#e11d48';

export interface SegmentRef {
    trackId: string;
    segment: number;
}

export interface SegmentPieces {
    // line pieces without pending and unrouted legs
    lines: LatLng[][];
    // unrouted legs: a straight line between waypoints
    unrouted: [LatLng, LatLng][];
}

export function segmentPieces(points: readonly LatLng[], route: SegmentRoute | null | undefined): SegmentPieces {
    const pieces: SegmentPieces = { lines: [], unrouted: [] };
    if (!route) {
        pieces.lines.push(points.slice());
        return pieces;
    }
    let current: LatLng[] = [];
    const flush = () => {
        if (current.length > 1) {
            pieces.lines.push(current);
        }
        current = [];
    };
    route.legs.forEach((leg, k) => {
        const from = route.waypoints[k];
        const to = route.waypoints[k + 1];
        const a = points[from];
        const b = points[to];
        if (!a || !b) {
            return;
        }
        // a pending leg is a gap without a marker: the badge at the mouse pointer shows the wait
        // (routing/RoutingBadgeOnMap.tsx, spec route-editing, «Разрыв на ожидающем отрезке»)
        if (leg.state === 'pending' || leg.state === 'failed') {
            flush();
            if (leg.state === 'failed') {
                pieces.unrouted.push([a, b]);
            }
            return;
        }
        const slice = points.slice(from, to + 1);
        current.push(...(current.length ? slice.slice(1) : slice));
    });
    flush();
    return pieces;
}

const toCoordinates = (line: readonly LatLng[]) => line.map((p) => [p.lng, p.lat]);

function line(coordinates: readonly LatLng[], properties: Record<string, unknown>): Feature<LineString> {
    return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: toCoordinates(coordinates) } };
}

// Track sources. skip is the segment in editing: the editor draws it.
export function trackSources(
    tracks: readonly Track[],
    skip: SegmentRef | null = null,
): { sources: Record<string, GeoJSONSourceSpecification> } {
    const visible = tracks.filter((track) => track.visible);
    const lines: Feature<LineString>[] = [];
    const unrouted: Feature<LineString>[] = [];
    for (const track of visible) {
        const color = trackColor(track.color);
        track.segments.forEach((points, segment) => {
            const pieces = segmentPieces(points, track.routes?.[segment]);
            if (skip && skip.trackId === track.id && skip.segment === segment) {
                return;
            }
            for (const piece of pieces.lines) {
                if (piece.length > 1) {
                    lines.push(line(piece, { id: track.id, segment, color }));
                }
            }
            for (const pair of pieces.unrouted) {
                unrouted.push(line(pair, { id: track.id, segment }));
            }
        });
    }
    const points: Feature<Point>[] = visible.flatMap((track) =>
        // index is the point index in the track: a click opens the point menu by it (design add-web-line-tools)
        track.points.map((point, index) => ({
            type: 'Feature' as const,
            properties: { id: track.id, index, color: trackColor(track.color), name: point.name },
            geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
        })),
    );
    return {
        sources: {
            [TRACK_LINES]: { type: 'geojson', data: { type: 'FeatureCollection', features: lines } },
            [TRACK_UNROUTED]: { type: 'geojson', data: { type: 'FeatureCollection', features: unrouted } },
            [TRACK_POINTS]: { type: 'geojson', data: { type: 'FeatureCollection', features: points } },
            // tick data depends on the zoom, and the map sets it (BaseMap); here the source is empty, so that the
            // layer always exists
            [TRACK_TICKS]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
    };
}

// Track lines and editor lines are offset to the right in the direction of travel (design offset-track-lines): on an
// out-and-back route, "there" and "back" along one road go in opposite directions, and the lines lie side by side,
// as lanes, not one on top of the other. The offset is half of the white track casing: the casings of the two
// directions touch. The data does not change, a MapLibre click searches on the offset line (queryRenderedFeatures
// uses line-offset)
export const TRACK_OFFSET_PX = 3.5;
// Only at close zoom (design offset-track-lines-by-zoom): the offset in pixels does not depend on the zoom, and in an
// overview the double lane is many times wider than the road, and the loops of switchbacks stick together. The
// threshold is MapLibre zoom 14 (m=15 in the address), the owner's choice from a screenshot sheet; up to 13 there is
// one line, between 13 and 14 the lines move apart smoothly, without a jump
export const TRACK_OFFSET_ZOOM = 14;
export const TRACK_LINE_OFFSET: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    TRACK_OFFSET_ZOOM - 1,
    0,
    TRACK_OFFSET_ZOOM,
    TRACK_OFFSET_PX,
];

// dashed line of an unrouted leg: line-dasharray is in line widths
export const UNROUTED_PAINT: LineLayerSpecification['paint'] = {
    'line-color': UNROUTED_COLOR,
    'line-width': 3,
    'line-dasharray': [2, 1.5],
    'line-offset': TRACK_LINE_OFFSET,
};

// The white casing is 1.5 px wider than the line on each side: on a light map it is almost invisible, on a dark one
// (satellite imagery, heatmap) it separates the line from the background
export const CASING_COLOR = '#fff';
// under the dashes, a solid line: white gaps between the dashes
export const UNROUTED_CASING_PAINT: LineLayerSpecification['paint'] = {
    'line-color': CASING_COLOR,
    'line-width': 6,
    'line-offset': TRACK_LINE_OFFSET,
};
const LINE_LAYOUT: LineLayerSpecification['layout'] = { 'line-cap': 'round', 'line-join': 'round' };

export const TRACK_LAYERS: LayerSpecification[] = [
    {
        id: TRACK_CASING,
        type: 'line',
        source: TRACK_LINES,
        layout: LINE_LAYOUT,
        paint: { 'line-color': CASING_COLOR, 'line-width': 7, 'line-offset': TRACK_LINE_OFFSET },
    },
    {
        id: TRACK_LINES,
        type: 'line',
        source: TRACK_LINES,
        layout: LINE_LAYOUT,
        paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-offset': TRACK_LINE_OFFSET },
    },
    {
        id: TRACK_UNROUTED_CASING,
        type: 'line',
        source: TRACK_UNROUTED,
        paint: UNROUTED_CASING_PAINT,
    },
    {
        id: TRACK_UNROUTED,
        type: 'line',
        source: TRACK_UNROUTED,
        paint: UNROUTED_PAINT,
    },
    // A label across the line, at a distance from it (.measure-tick-icon-text of the old client: padding-left 0.7em,
    // bold 10 px, white halo); above all labels, and it does not push them out: the ticks are at least 15 mm apart
    {
        id: TRACK_TICKS,
        type: 'symbol',
        source: TRACK_TICKS,
        layout: {
            'text-field': ['get', 'label'],
            'text-font': ['sans-serif'],
            'text-size': 11,
            'text-anchor': 'left',
            'text-offset': [0.7, 0],
            'text-rotate': ['get', 'rotate'],
            'text-rotation-alignment': 'map',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: { 'text-color': '#000', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    },
    {
        id: TRACK_POINTS,
        type: 'circle',
        source: TRACK_POINTS,
        paint: {
            'circle-radius': 5,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#fff',
            'circle-stroke-width': 1.5,
        },
    },
    {
        id: TRACK_LABELS,
        type: 'symbol',
        source: TRACK_POINTS,
        layout: {
            'text-field': ['get', 'name'],
            'text-font': ['sans-serif'],
            'text-size': 12,
            'text-anchor': 'left',
            'text-offset': [0.8, 0],
        },
        paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    },
];
