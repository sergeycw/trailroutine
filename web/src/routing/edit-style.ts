import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { CircleLayerSpecification, GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { RouteEditState } from '@/state/store';
import type { LatLng } from '@/tracks/model';
import { CASING_COLOR, TRACK_LINE_OFFSET, UNROUTED_CASING_PAINT, UNROUTED_PAINT } from '@/tracks/style';
import { legPath } from './line';

// The edited line on the map (design add-web-route-editor, «Отрисовка»): the sources are always in the style (empty
// without editing), so that the layer order is stable. The look is as in the old editor (edit_line.css): a thin opaque
// line in the track color, waypoints are white circles with a dark outline, the start is green, the end is red; the
// white outline under the line is as on tracks (design map-chrome). A pending leg is not drawn (a gap with a spinner),
// an unrouted leg has the same dashes with an outline as tracks.
//
// The preview (the rubber band while drawing, the dragged point with straight lines to its neighbors) changes on each
// mouse move, so its source in the style is always empty, and MapEditor sets its data directly (setData), past the
// style: the MapLibre style diff compares the data of all GeoJSON sources element by element, and an imported line has
// thousands of waypoints. Any style rebuild resets the preview to empty: the next mouse move brings it back.

export const EDIT_LEGS = 'route-edit-legs';
export const EDIT_LINE = 'route-edit-line';
export const EDIT_CASING = 'route-edit-casing';
export const EDIT_UNROUTED_CASING = 'route-edit-unrouted-casing';
export const EDIT_UNROUTED = 'route-edit-unrouted';
export const EDIT_PREVIEW = 'route-edit-preview';
export const EDIT_WAYPOINTS = 'route-edit-waypoints';
export const EDIT_PREVIEW_POINT = 'route-edit-preview-point';

const toCoordinates = (line: readonly LatLng[]) => line.map((p) => [p.lng, p.lat]);

function collection<T extends Feature>(features: T[]): GeoJSONSourceSpecification {
    return { type: 'geojson', data: { type: 'FeatureCollection', features } };
}

// drag is the index of the dragged waypoint: the preview draws it and its legs
export function editSources(
    edit: RouteEditState | null,
    color: string,
    drag: number | null,
): Record<string, GeoJSONSourceSpecification> {
    const legs: Feature<LineString>[] = [];
    const waypoints: Feature<Point>[] = [];
    if (edit) {
        const { line } = edit;
        line.legs.forEach((leg, index) => {
            if (leg.state === 'pending' || (drag !== null && (index === drag - 1 || index === drag))) {
                return;
            }
            legs.push({
                type: 'Feature',
                properties: { leg: index, state: leg.state, color, unrouted: leg.state === 'failed' },
                geometry: { type: 'LineString', coordinates: toCoordinates(legPath(line, index)) },
            });
        });
        line.waypoints.forEach((point, index) => {
            if (index === drag) {
                return;
            }
            waypoints.push({
                type: 'Feature',
                properties: { index, role: waypointRole(index, line.waypoints.length) },
                geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
            });
        });
    }
    return {
        [EDIT_LEGS]: collection(legs),
        [EDIT_PREVIEW]: collection([]),
        [EDIT_WAYPOINTS]: collection(waypoints),
    };
}

export function waypointRole(index: number, count: number): 'start' | 'end' | 'middle' {
    return index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
}

// Preview data: straight lines and, during a drag, the point itself (drawn as a waypoint)
export function previewData(
    lines: readonly (readonly LatLng[])[],
    color: string,
    point?: { latlng: LatLng; role: string },
): FeatureCollection {
    const features: Feature[] = lines.map((line) => ({
        type: 'Feature',
        properties: { color },
        geometry: { type: 'LineString', coordinates: toCoordinates(line) },
    }));
    if (point) {
        features.push({
            type: 'Feature',
            properties: { role: point.role },
            geometry: { type: 'Point', coordinates: [point.latlng.lng, point.latlng.lat] },
        });
    }
    return { type: 'FeatureCollection', features };
}

// The map choice for Join and Shortcut (design add-web-line-tools, «Выбор на карте»): the line from the start to the
// cursor is green dashes over a valid place, red dashes over an invalid place (lineCursorValidStyle/InvalidStyle of the
// old client), and the part that Shortcut removes is a red line
export const TOOL_VALID = '#16a34a';
export const TOOL_INVALID = '#e11d48';

export function toolPreviewData(band: readonly LatLng[], valid: boolean, removed: readonly LatLng[] | null = null) {
    const lines = [{ path: band, color: valid ? TOOL_VALID : TOOL_INVALID }];
    if (removed) {
        lines.unshift({ path: removed, color: TOOL_INVALID });
    }
    return {
        type: 'FeatureCollection' as const,
        features: lines.map(({ path, color }) => ({
            type: 'Feature' as const,
            properties: { color },
            geometry: { type: 'LineString' as const, coordinates: toCoordinates(path) },
        })),
    };
}

const WAYPOINT_PAINT = {
    'circle-radius': 6,
    'circle-color': ['match', ['get', 'role'], 'start', '#33bf33', 'end', '#e63333', '#fff'],
    'circle-stroke-color': '#333',
    'circle-stroke-width': 2,
} as const satisfies CircleLayerSpecification['paint'];

export const EDIT_LAYERS: LayerSpecification[] = [
    {
        id: EDIT_CASING,
        type: 'line',
        source: EDIT_LEGS,
        filter: ['!', ['get', 'unrouted']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': CASING_COLOR, 'line-width': 5.5, 'line-offset': TRACK_LINE_OFFSET },
    },
    {
        id: EDIT_LINE,
        type: 'line',
        source: EDIT_LEGS,
        filter: ['!', ['get', 'unrouted']],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-offset': TRACK_LINE_OFFSET },
    },
    {
        id: EDIT_UNROUTED_CASING,
        type: 'line',
        source: EDIT_LEGS,
        filter: ['get', 'unrouted'],
        paint: UNROUTED_CASING_PAINT,
    },
    { id: EDIT_UNROUTED, type: 'line', source: EDIT_LEGS, filter: ['get', 'unrouted'], paint: UNROUTED_PAINT },
    {
        id: EDIT_PREVIEW,
        type: 'line',
        source: EDIT_PREVIEW,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] },
    },
    { id: EDIT_WAYPOINTS, type: 'circle', source: EDIT_WAYPOINTS, paint: WAYPOINT_PAINT },
    {
        id: EDIT_PREVIEW_POINT,
        type: 'circle',
        source: EDIT_PREVIEW,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: WAYPOINT_PAINT,
    },
];
