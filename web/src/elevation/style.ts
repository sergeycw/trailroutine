import type { Feature, MultiLineString } from 'geojson';
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { LatLng } from '@/tracks/model';
import { TRACK_LINE_OFFSET } from '@/tracks/style';

// The selected profile section on the map (polyLineSelection of the old client: a yellow semi-transparent wide line
// below the tracks). The source is always in the style, and it is empty: ProfileOnMap sets the data with setData
// past the style, as the editor preview does (routing/edit-style.ts), so the style diff does not run on each mouse
// move.

export const PROFILE_SELECTION = 'elevation-profile-selection';

export const PROFILE_SOURCES: Record<string, GeoJSONSourceSpecification> = {
    [PROFILE_SELECTION]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
};

export const PROFILE_LAYERS: LayerSpecification[] = [
    {
        id: PROFILE_SELECTION,
        type: 'line',
        source: PROFILE_SELECTION,
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        // along the axis of the offset track line, not along the geometry (tracks/style.ts)
        paint: { 'line-color': '#ffeb3b', 'line-width': 16, 'line-opacity': 0.6, 'line-offset': TRACK_LINE_OFFSET },
    },
];

// The section from..to (fractional indexes of the sample points) along the profile segments: the code does not draw
// a link across a joint
export function selectionFeature(
    points: readonly LatLng[],
    starts: readonly number[],
    from: number,
    to: number,
): Feature<MultiLineString> {
    const lines: number[][][] = [];
    const lo = Math.max(0, Math.min(from, to));
    const hi = Math.min(points.length - 1, Math.max(from, to));
    starts.forEach((start, k) => {
        const end = (starts[k + 1] ?? points.length) - 1;
        const a = Math.max(lo, start);
        const b = Math.min(hi, end);
        if (b <= a) {
            return;
        }
        const coords: number[][] = [lerp(points, a)];
        for (let i = Math.floor(a) + 1; i < b; i++) {
            coords.push([points[i].lng, points[i].lat]);
        }
        coords.push(lerp(points, b));
        lines.push(coords);
    });
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

function lerp(points: readonly LatLng[], index: number): number[] {
    const i = Math.floor(index);
    const q = index - i;
    const a = points[i];
    const b = points[Math.min(i + 1, points.length - 1)];
    return [a.lng + (b.lng - a.lng) * q, a.lat + (b.lat - a.lat) * q];
}
