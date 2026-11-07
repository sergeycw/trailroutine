import { isRouteShape, routeFits, type SegmentRoute, settledRoute } from '@/routing/line';
import type { GeoData, LatLng, Track, TrackColor, Waypoint } from '@/tracks/model';

// The record of the working set in IndexedDB (design add-web-autosave, «Автосохранение: структура в IndexedDB»):
// exact coordinates without rounding and simplification, so the waypoint indexes of the markup stay correct as they
// are. A segment is a Float64Array (lat, lng in sequence): structured clone copies the buffer and does not walk the
// {lat, lng} objects.

// A new record shape is a new version; the read skips a record of a different version, and the next write replaces it
export const SAVED_VERSION = 1;

export interface SavedTrack {
    name: string;
    // a palette index or a custom '#rrggbb' (design track-color-picker): records with an index read as before
    color: TrackColor;
    visible: boolean;
    measureTicksShown: boolean;
    segments: Float64Array[];
    points: Waypoint[];
    routes: (SegmentRoute | null)[];
}

export interface SavedSet {
    version: number;
    tracks: SavedTrack[];
}

function packLine(line: readonly LatLng[]): Float64Array {
    const packed = new Float64Array(line.length * 2);
    for (let i = 0; i < line.length; i++) {
        packed[2 * i] = line[i].lat;
        packed[2 * i + 1] = line[i].lng;
    }
    return packed;
}

function unpackLine(packed: Float64Array): LatLng[] {
    const line: LatLng[] = [];
    for (let i = 0; i + 1 < packed.length; i += 2) {
        line.push({ lat: packed[i], lng: packed[i + 1] });
    }
    return line;
}

// The code writes a pending segment as not routed: after a reload, no answer comes for the previous request
function savedRoute(line: readonly LatLng[], route: SegmentRoute | null | undefined): SegmentRoute | null {
    if (!isRouteShape(route)) {
        return null;
    }
    const settled = settledRoute(route);
    return settled && routeFits(line, settled) ? settled : null;
}

export function toSaved(tracks: readonly Track[]): SavedSet {
    return {
        version: SAVED_VERSION,
        tracks: tracks.map((track) => ({
            name: track.name,
            color: track.color,
            visible: track.visible,
            measureTicksShown: track.measureTicksShown ?? false,
            segments: track.segments.map(packLine),
            points: track.points.map(({ lat, lng, name }) => ({ lat, lng, name })),
            routes: track.segments.map((line, i) => savedRoute(line, track.routes?.[i])),
        })),
    };
}

function isSavedTrack(value: unknown): value is SavedTrack {
    const track = value as SavedTrack | null;
    return (
        typeof track === 'object' &&
        track !== null &&
        typeof track.name === 'string' &&
        Array.isArray(track.segments) &&
        track.segments.every((segment) => segment instanceof Float64Array) &&
        Array.isArray(track.points) &&
        Array.isArray(track.routes)
    );
}

// Record → tracks for addTracks. null means there is no record, or it has a different version, or it is corrupted.
// The code discards a segment shorter than two points (saved in the middle of a drawing), and also a track without
// segments and points: this is how the edit ends (spec route-editing, «Начало и конец редактирования»). The code
// discards markup that does not agree with the points.
export function fromSaved(value: unknown): GeoData[] | null {
    const set = value as SavedSet | null;
    if (typeof set !== 'object' || set === null || set.version !== SAVED_VERSION || !Array.isArray(set.tracks)) {
        return null;
    }
    const tracks: GeoData[] = [];
    for (const saved of set.tracks) {
        if (!isSavedTrack(saved)) {
            continue;
        }
        const segments: LatLng[][] = [];
        const routes: (SegmentRoute | null)[] = [];
        saved.segments.forEach((packed, i) => {
            const line = unpackLine(packed);
            if (line.length >= 2) {
                segments.push(line);
                routes.push(savedRoute(line, saved.routes[i]));
            }
        });
        const points = saved.points.filter(
            (point) =>
                typeof point?.lat === 'number' && typeof point.lng === 'number' && typeof point.name === 'string',
        );
        if (segments.length === 0 && points.length === 0) {
            continue;
        }
        tracks.push({
            name: saved.name,
            segments,
            points,
            color: saved.color,
            hidden: !saved.visible,
            measureTicksShown: Boolean(saved.measureTicksShown),
            ...(routes.some(Boolean) ? { routes } : {}),
        });
    }
    return tracks;
}
