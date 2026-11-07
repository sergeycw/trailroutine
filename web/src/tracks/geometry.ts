import type { LatLng } from './model';

// Track geometry without a map. The formulas are as in Leaflet 1.0.3 of the old client, so that lengths, simplification
// and links match it: CRS.Earth (R = 6 371 000 m, spherical law of cosines), LineUtil.simplify (radius filter +
// Douglas–Peucker) in degrees, as L.LineUtil.simplifyLatlngs (src/lib/leaflet.lineutil.simplifyLatLngs).

const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;

// Simplification tolerance on import and in links is the nktk grid step (arcUnit = (2^24 − 1) / 360), ≈ 2.4 m
export const SIMPLIFY_TOLERANCE = 360 / (1 << 24);

export function distance(a: LatLng, b: LatLng): number {
    const lat1 = a.lat * RAD;
    const lat2 = b.lat * RAD;
    const cos = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos((b.lng - a.lng) * RAD);
    return EARTH_RADIUS * Math.acos(Math.min(cos, 1));
}

export function lineLength(line: readonly LatLng[]): number {
    let length = 0;
    for (let i = 1; i < line.length; i++) {
        length += distance(line[i - 1], line[i]);
    }
    return length;
}

const lengthCache = new WeakMap<readonly (readonly LatLng[])[], number>();

// The track length is cached by the reference to the segments array: the store replaces the whole array on any edit
export function tracksLength(segments: readonly (readonly LatLng[])[]): number {
    let length = lengthCache.get(segments);
    if (length === undefined) {
        length = segments.reduce((sum, line) => sum + lineLength(line), 0);
        lengthCache.set(segments, length);
    }
    return length;
}

// formatLength of the old client
export function formatLength(meters: number): string {
    const digits = meters < 10000 ? 2 : meters < 100000 ? 1 : 0;
    return `${(meters / 1000).toFixed(digits)} km`;
}

function sqDist(a: LatLng, b: LatLng) {
    const dx = a.lng - b.lng;
    const dy = a.lat - b.lat;
    return dx * dx + dy * dy;
}

function sqDistToSegment(p: LatLng, a: LatLng, b: LatLng) {
    let x = a.lng;
    let y = a.lat;
    const dx = b.lng - x;
    const dy = b.lat - y;
    const dot = dx * dx + dy * dy;
    if (dot > 0) {
        const t = ((p.lng - x) * dx + (p.lat - y) * dy) / dot;
        if (t > 1) {
            x = b.lng;
            y = b.lat;
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }
    return (p.lng - x) ** 2 + (p.lat - y) ** 2;
}

// L.LineUtil.simplify. Douglas–Peucker uses a stack, not recursion: with recursion, a large GPX with a straight line
// overflows the call stack.
export function simplify<T extends LatLng>(points: readonly T[], tolerance = SIMPLIFY_TOLERANCE): T[] {
    if (!tolerance || points.length === 0) {
        return points.slice();
    }
    const sqTolerance = tolerance * tolerance;

    const reduced = [points[0]];
    let prev = 0;
    for (let i = 1; i < points.length; i++) {
        if (sqDist(points[i], points[prev]) > sqTolerance) {
            reduced.push(points[i]);
            prev = i;
        }
    }
    if (prev < points.length - 1) {
        reduced.push(points[points.length - 1]);
    }

    const markers = new Uint8Array(reduced.length);
    markers[0] = 1;
    markers[reduced.length - 1] = 1;
    const stack: [number, number][] = [[0, reduced.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop() as [number, number];
        let maxSqDist = 0;
        let index = 0;
        for (let i = first + 1; i < last; i++) {
            const d = sqDistToSegment(reduced[i], reduced[first], reduced[last]);
            if (d > maxSqDist) {
                index = i;
                maxSqDist = d;
            }
        }
        if (maxSqDist > sqTolerance) {
            markers[index] = 1;
            stack.push([index, last], [first, index]);
        }
    }
    return reduced.filter((_, i) => markers[i]);
}

// LatLng.wrap() of Leaflet: wrapNum(lng, [-180, 180], includeMax): exactly 180 stays 180
export function wrapLng(lng: number): number {
    return lng === 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
}

// unwrapLatLngsCrossing180Meridian of the old client: each next point goes into the world copy that is nearer to the
// previous point, so a line across 180° stays continuous (the longitude can go outside ±180, MapLibre draws this)
export function unwrapLine(line: readonly LatLng[]): LatLng[] {
    const result: LatLng[] = [];
    for (const point of line) {
        const prev = result.at(-1);
        if (!prev) {
            result.push({ lat: point.lat, lng: point.lng });
            continue;
        }
        const lng = point.lng + 360 * Math.round((prev.lng - point.lng) / 360);
        result.push({ lat: point.lat, lng });
    }
    return result;
}

// A line when it is added to the list (addTracksFromGeodataArray of the old client): unwrap across 180°, simplify,
// repeat a single point: otherwise a line of one point is not drawn and cannot be edited
export function normalizeLine(line: readonly LatLng[]): LatLng[] {
    const simplified = simplify(unwrapLine(line));
    if (simplified.length === 1) {
        simplified.push({ ...simplified[0] });
    }
    return simplified;
}

function splitLat(a: LatLng, b: LatLng, lng: number) {
    return a.lat + ((b.lat - a.lat) / (b.lng - a.lng)) * (lng - a.lng);
}

function positiveLng(lng: number) {
    return ((lng % 360) + 360) % 360;
}

// splitLinesAt180Meridian of the old client (meridian180.js): for export, longitudes go into [−180, 180), and a
// segment that crosses 180° is split in two, with points 0.000001° from the meridian on both sides
export function splitAt180(line: readonly LatLng[]): LatLng[][] {
    if (line.length < 2) {
        return [];
    }
    const wrapped = line.map((p) => ({ lat: p.lat, lng: wrapLng(p.lng) }));
    const lines: LatLng[][] = [[wrapped[0]]];
    for (let i = 1; i < wrapped.length; i++) {
        const point = wrapped[i];
        const prev = wrapped[i - 1];
        const current = lines[lines.length - 1];
        if (Math.abs(point.lng - prev.lng) <= 180) {
            current.push(point);
            continue;
        }
        const a = { lat: prev.lat, lng: positiveLng(prev.lng) };
        const b = { lat: point.lat, lng: positiveLng(point.lng) };
        const splitLng = 180 - 0.000001 * Math.sign(point.lng);
        const splitPrevLng = 180 - 0.000001 * Math.sign(prev.lng);
        current.push({ lat: splitLat(a, b, splitPrevLng), lng: wrapLng(splitPrevLng) });
        lines.push([{ lat: splitLat(a, b, splitLng), lng: wrapLng(splitLng) }, point]);
    }
    return lines;
}

export function splitLinesAt180(lines: readonly (readonly LatLng[])[]): LatLng[][] {
    return lines.flatMap(splitAt180);
}

export interface Bounds {
    west: number;
    south: number;
    east: number;
    north: number;
}

export function boundsOf(points: Iterable<LatLng>): Bounds | null {
    let bounds: Bounds | null = null;
    for (const { lat, lng } of points) {
        if (!bounds) {
            bounds = { west: lng, south: lat, east: lng, north: lat };
            continue;
        }
        bounds.west = Math.min(bounds.west, lng);
        bounds.east = Math.max(bounds.east, lng);
        bounds.south = Math.min(bounds.south, lat);
        bounds.north = Math.max(bounds.north, lat);
    }
    return bounds;
}
