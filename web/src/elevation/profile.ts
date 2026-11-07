import { distance } from '@/tracks/geometry';
import type { LatLng } from '@/tracks/model';

// The elevation profile without the map and React (design add-web-elevation-profile, «Выборка», «Сводка и шкала»).
// The reference is src/lib/leaflet.control.elevation-profile/index.js of the old client; the differences from it are
// the fixes that the Context of the design lists.

// calcSamplingInterval of the old client without changes: 2 000 points for a usual track, a step of 10–50 m, but not
// more than 9 999 points, which is one request to the elevation API (the limit is 10 000 points, spec elevation-api).
// The starts and ends of segments add points over the step, and sampleSegments counts them.
export function samplingInterval(length: number): number {
    const targetPoints = 2000;
    const maxPoints = 9999;
    let interval = Math.min(Math.max(length / targetPoints, 10), 50);
    if (length / interval > maxPoints) {
        interval = length / maxPoints;
    }
    return interval;
}

export interface ProfileSamples {
    points: LatLng[];
    // the distance of each point from the profile start, m: along the line length; a joint of segments does not
    // add distance
    distances: Float64Array;
    // the indexes of the points where each segment starts (starts[0] = 0): a link across a joint is not a link of
    // the line
    starts: number[];
    length: number;
}

// Points at an equal step from the start of each segment, and always the segment end (in pathRegularSamples of the
// old client, a tail shorter than the step was lost). The code skips segments of zero length. Points between the
// vertices are linear in latitude and longitude, as in the old client: the step is 10–100 m, and the projection
// distortion on it is very small.
export function sampleSegments(segments: readonly (readonly LatLng[])[], step?: number): ProfileSamples {
    const lengths = segments.map(segmentLength);
    const total = lengths.reduce((sum, value) => sum + value, 0);
    const interval = step ?? fittingInterval(total, lengths.filter((length) => length > 0).length);
    const points: LatLng[] = [];
    const distances: number[] = [];
    const starts: number[] = [];
    let offset = 0;
    segments.forEach((line, k) => {
        if (lengths[k] === 0) {
            return;
        }
        starts.push(points.length);
        points.push({ lat: line[0].lat, lng: line[0].lng });
        distances.push(offset);
        let lastSample = 0;
        let walked = 0;
        for (let i = 1; i < line.length; i++) {
            const a = line[i - 1];
            const b = line[i];
            const legLength = distance(a, b);
            const next = walked + legLength;
            while (lastSample + interval <= next) {
                lastSample += interval;
                const q = (lastSample - walked) / legLength;
                points.push({ lat: a.lat + (b.lat - a.lat) * q, lng: a.lng + (b.lng - a.lng) * q });
                distances.push(offset + lastSample);
            }
            walked = next;
        }
        // the segment end, if the last sample point is not on it (the tolerance is a centimeter: the accumulated
        // error of the sums)
        if (walked - lastSample > 0.01) {
            const end = line[line.length - 1];
            points.push({ lat: end.lat, lng: end.lng });
            distances.push(offset + walked);
        }
        offset += walked;
    });
    return { points, distances: Float64Array.from(distances), starts, length: offset };
}

// The step at which the samples fit in one request: a segment has not more than length / step + 2 points (the start
// and the end over the step), so with many segments the step grows. With more than 4 999 segments the samples do
// not fit in one request, and api.ts splits it.
const MAX_SAMPLES = 10000;

function fittingInterval(total: number, segments: number): number {
    const interval = samplingInterval(total);
    const budget = MAX_SAMPLES - 2 * segments;
    return budget > 0 && total / interval > budget ? total / budget : interval;
}

function segmentLength(line: readonly LatLng[]): number {
    let length = 0;
    for (let i = 1; i < line.length; i++) {
        length += distance(line[i - 1], line[i]);
    }
    return length;
}

export type Elevation = number | null;

export interface Inclination {
    // degrees, rounded as gradientToAngle of the old client
    avg: number;
    max: number;
}

export interface ProfileStats {
    distance: number;
    // no point with data
    noData: boolean;
    min: number;
    max: number;
    start: number;
    end: number;
    ascent: number;
    descent: number;
    ascentAngle: Inclination | null;
    descentAngle: Inclination | null;
    // more than 2 % of the points have no data: at the start, at the end, in total (the mark «~» and
    // «Some elevation data missing»)
    approxStart: boolean;
    approxEnd: boolean;
    missing: boolean;
}

const APPROX_SHARE = 0.02;
// the tolerance of the elevation simplification before the count of ascent and descent (filterTolerance of the old
// client)
export const ASCENT_TOLERANCE = 5;

const toAngle = (gradient: number) => Math.round((Math.atan(gradient) * 180) / Math.PI);

// The profile summary on the points from..to (inclusive): calcProfileStats of the old client with fixes. The code
// discards points without data before the simplification (in the old client null stayed and counted as zero), the
// last point with data is in the ascent, the simplification and the grades use the distance, and a joint of
// segments is not a step.
export function profileStats(
    profile: Pick<ProfileSamples, 'distances' | 'starts'>,
    values: readonly Elevation[],
    from = 0,
    to = values.length - 1,
): ProfileStats {
    const { distances, starts } = profile;
    const count = to - from + 1;
    const stats: ProfileStats = {
        distance: count > 0 ? distances[to] - distances[from] : 0,
        noData: true,
        min: 0,
        max: 0,
        start: 0,
        end: 0,
        ascent: 0,
        descent: 0,
        ascentAngle: null,
        descentAngle: null,
        approxStart: false,
        approxEnd: false,
        missing: false,
    };
    let first = -1;
    let last = -1;
    let known = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = from; i <= to; i++) {
        const value = values[i];
        if (value === null || value === undefined) {
            continue;
        }
        known++;
        if (first < 0) {
            first = i;
        }
        last = i;
        min = Math.min(min, value);
        max = Math.max(max, value);
    }
    if (known === 0) {
        stats.missing = count > 0;
        return stats;
    }
    stats.noData = false;
    stats.min = min;
    stats.max = max;
    stats.start = values[first] as number;
    stats.end = values[last] as number;
    stats.approxStart = (first - from) / count > APPROX_SHARE;
    stats.approxEnd = (to - last) / count > APPROX_SHARE;
    stats.missing = 1 - known / count > APPROX_SHARE;

    // by segments: the points with data, their simplification and the grades of the steps
    let ascentRise = 0;
    let ascentRun = 0;
    let ascentMax = Number.NEGATIVE_INFINITY;
    let descentDrop = 0;
    let descentRun = 0;
    let descentMax = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < starts.length; k++) {
        const begin = Math.max(starts[k], from);
        const end = Math.min((starts[k + 1] ?? values.length) - 1, to);
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = begin; i <= end; i++) {
            const value = values[i];
            if (value !== null && value !== undefined) {
                xs.push(distances[i]);
                ys.push(value);
            }
        }
        for (let j = 1; j < xs.length; j++) {
            const run = xs[j] - xs[j - 1];
            const rise = ys[j] - ys[j - 1];
            if (run <= 0) {
                continue;
            }
            if (rise > 0) {
                ascentRise += rise;
                ascentRun += run;
                ascentMax = Math.max(ascentMax, rise / run);
            } else if (rise < 0) {
                descentDrop -= rise;
                descentRun += run;
                descentMax = Math.max(descentMax, -rise / run);
            }
        }
        const kept = simplifyProfile(xs, ys, ASCENT_TOLERANCE);
        for (let j = 1; j < kept.length; j++) {
            const delta = ys[kept[j]] - ys[kept[j - 1]];
            if (delta > 0) {
                stats.ascent += delta;
            } else {
                stats.descent -= delta;
            }
        }
    }
    if (ascentRun > 0) {
        stats.ascentAngle = { avg: toAngle(ascentRise / ascentRun), max: toAngle(ascentMax) };
    }
    if (descentRun > 0) {
        stats.descentAngle = { avg: toAngle(descentDrop / descentRun), max: toAngle(descentMax) };
    }
    return stats;
}

// filterElevations of the old client: Douglas–Peucker by the vertical error from the straight line between the key
// points, but by distance, not by point index. Returns the indexes of the kept points in ascending order. Uses a
// stack, not recursion.
export function simplifyProfile(xs: readonly number[], ys: readonly number[], tolerance: number): number[] {
    const n = xs.length;
    if (n < 3) {
        return Array.from({ length: n }, (_, i) => i);
    }
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const stack: [number, number][] = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop() as [number, number];
        const span = xs[b] - xs[a];
        let worst = -1;
        let worstError = tolerance;
        for (let i = a + 1; i < b; i++) {
            const linear = span > 0 ? ys[a] + ((ys[b] - ys[a]) * (xs[i] - xs[a])) / span : ys[a];
            const error = Math.abs(ys[i] - linear);
            if (error > worstError) {
                worstError = error;
                worst = i;
            }
        }
        if (worst >= 0) {
            keep[worst] = 1;
            stack.push([a, worst], [worst, b]);
        }
    }
    const kept: number[] = [];
    keep.forEach((flag, i) => {
        if (flag) {
            kept.push(i);
        }
    });
    return kept;
}

// calcGridValues of the old client: 3–5 scale lines with a round step that cover min..max
export function gridValues(min: number, max: number): number[] {
    const counts = [3, 4, 5];
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    let first = 0;
    let count = counts[counts.length - 1];
    let step = steps[steps.length - 1];
    search: for (const candidate of steps) {
        for (const n of counts) {
            const lo = Math.floor(min / candidate);
            const hi = Math.ceil(max / candidate);
            if (hi - lo < n) {
                first = lo;
                count = n;
                step = candidate;
                break search;
            }
        }
    }
    return Array.from({ length: count }, (_, i) => (first + i) * step);
}

// The point on the profile line at a fractional index: linear between the adjacent sample points
// (setCursorPosition of the old client)
export function pointAt(points: readonly LatLng[], index: number): LatLng {
    if (index <= 0) {
        return points[0];
    }
    if (index >= points.length - 1) {
        return points[points.length - 1];
    }
    const i = Math.floor(index);
    const q = index - i;
    const a = points[i];
    const b = points[i + 1];
    return { lat: a.lat + (b.lat - a.lat) * q, lng: a.lng + (b.lng - a.lng) * q };
}

export function distanceAt(distances: Float64Array, index: number): number {
    if (index <= 0) {
        return distances[0];
    }
    if (index >= distances.length - 1) {
        return distances[distances.length - 1];
    }
    const i = Math.floor(index);
    return distances[i] + (distances[i + 1] - distances[i]) * (index - i);
}

// The fractional point index by the distance from the start (the graph cursor is at a distance, and the sample
// points are not equally spaced at the segment ends). At a joint of segments two points have the same distance: the
// code takes the second one, the start of the next segment.
export function indexAtDistance(distances: Float64Array, at: number): number {
    const n = distances.length;
    if (n === 0 || at <= distances[0]) {
        return 0;
    }
    if (at >= distances[n - 1]) {
        return n - 1;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (distances[mid] <= at) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    const span = distances[hi] - distances[lo];
    return span > 0 ? lo + (at - distances[lo]) / span : lo;
}

// The elevation at the cursor: at the sample point, otherwise an adjacent one with data (as in the old client: the
// nearest, then floor, then ceil)
export function elevationAt(values: readonly Elevation[], index: number): Elevation {
    const near = values[Math.round(index)];
    if (near !== null && near !== undefined) {
        return near;
    }
    return values[Math.floor(index)] ?? values[Math.ceil(index)] ?? null;
}

// The profile colors by slope (design slope-profile, «Уклон по участкам», «Ступени в процентах по модулю»). The
// sample step (10–50 m) is smaller than the cell of the 3″ elevation data (≈ 90 m): the grade between adjacent points
// is interpolation noise, so the code calculates the grade on sections not shorter than sectionLength.

// the step thresholds, absolute %: < 3, 3–6, 6–10, 10–15, 15–25, ≥ 25
export const SLOPE_STEPS = [3, 6, 10, 15, 25];

// the step colors: a sequential scale, the OKLCH lightness strictly decreases (94.5 → 39.6 %), so the order is
// readable also without hue perception. The classes are full strings, so the Tailwind scanner finds them.
export const SLOPE_CLASSES = [
    { fill: 'fill-yellow-200', swatch: 'bg-yellow-200' },
    { fill: 'fill-amber-300', swatch: 'bg-amber-300' },
    { fill: 'fill-orange-400', swatch: 'bg-orange-400' },
    { fill: 'fill-orange-600', swatch: 'bg-orange-600' },
    { fill: 'fill-red-700', swatch: 'bg-red-700' },
    { fill: 'fill-red-900', swatch: 'bg-red-900' },
];

// a section is not shorter than a data cell and not smaller than 1/200 of the profile: on a phone graph (≈ 350 px)
// this is ≥ 1.7 px. It depends on the data, not on the graph width, so the color is the same on the graph, at the
// marker on the map and at all zooms.
const MIN_SECTION = 100;
const MAX_SECTIONS = 200;

export function sectionLength(length: number): number {
    return Math.max(MIN_SECTION, length / MAX_SECTIONS);
}

export interface SlopeSection {
    // the indexes of the end sample points; adjacent sections of a run share the point on the border
    from: number;
    to: number;
    // the grade, signed %: the elevation difference of the ends divided by the length
    grade: number;
}

// Sections along the runs of points with data inside the segments (they break at the same places as the graph
// polyline): from the run start, the code collects points until the length reaches length; a tail shorter than
// length / 2 goes into the previous section of the run.
export function slopeSections(
    profile: Pick<ProfileSamples, 'distances' | 'starts'>,
    values: readonly Elevation[],
    length = sectionLength(profile.distances[profile.distances.length - 1] - profile.distances[0] || 0),
): SlopeSection[] {
    const { distances, starts } = profile;
    const sections: SlopeSection[] = [];
    const grade = (from: number, to: number) =>
        (((values[to] as number) - (values[from] as number)) / (distances[to] - distances[from])) * 100;
    const closeRun = (first: number, last: number) => {
        const before = sections.length;
        let from = first;
        for (let i = first + 1; i <= last; i++) {
            if (distances[i] - distances[from] >= length) {
                sections.push({ from, to: i, grade: grade(from, i) });
                from = i;
            }
        }
        if (from === last || distances[last] <= distances[from]) {
            return;
        }
        const previous = sections.length > before ? sections[sections.length - 1] : null;
        if (previous && distances[last] - distances[from] < length / 2) {
            previous.to = last;
            previous.grade = grade(previous.from, last);
            return;
        }
        sections.push({ from, to: last, grade: grade(from, last) });
    };
    starts.forEach((start, k) => {
        const end = (starts[k + 1] ?? values.length) - 1;
        let first = -1;
        for (let i = start; i <= end; i++) {
            const known = values[i] !== null && values[i] !== undefined;
            if (known && first < 0) {
                first = i;
            }
            if (first >= 0 && (!known || i === end)) {
                closeRun(first, known ? i : i - 1);
                first = -1;
            }
        }
    });
    return sections;
}

// the step index by the absolute grade rounded to an integer, the same number as at the cursor
export function slopeClass(grade: number): number {
    const percent = Math.round(Math.abs(grade));
    const step = SLOPE_STEPS.findIndex((threshold) => percent < threshold);
    return step < 0 ? SLOPE_STEPS.length : step;
}

// The section at a fractional point index; at the shared point of two sections, the next one; at the end of a run,
// its last section; outside the sections (points without data, a joint), null
export function sectionAt(sections: readonly SlopeSection[], index: number): SlopeSection | null {
    let lo = 0;
    let hi = sections.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const section = sections[mid];
        if (index < section.from) {
            hi = mid - 1;
        } else if (index >= section.to) {
            lo = mid + 1;
        } else {
            return section;
        }
    }
    // index is exactly at the end of a section, and no section starts at the same place after it
    const last = sections[hi];
    return last && index === last.to ? last : null;
}

export interface ScreenPoint {
    x: number;
    y: number;
}

// The nearest place on the profile line to the screen point cursor: a fractional sample point index, or null if it
// is farther than maxDistance px. Links across a joint of segments do not count. A projection instead of
// queryRenderedFeatures on an invisible wide line of the old client: it does not depend on the drawn map frame
// (design, «Курсор на карте»).
export function nearestIndex(
    screen: readonly ScreenPoint[],
    starts: readonly number[],
    cursor: ScreenPoint,
    maxDistance: number,
): number | null {
    let best: number | null = null;
    let bestDistance = maxDistance * maxDistance;
    const isStart = new Set(starts);
    for (let i = 0; i < screen.length; i++) {
        const a = screen[i];
        const pointDistance = (cursor.x - a.x) ** 2 + (cursor.y - a.y) ** 2;
        if (pointDistance <= bestDistance) {
            bestDistance = pointDistance;
            best = i;
        }
        const b = screen[i + 1];
        if (!b || isStart.has(i + 1)) {
            continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq === 0) {
            continue;
        }
        const t = ((cursor.x - a.x) * dx + (cursor.y - a.y) * dy) / lengthSq;
        if (t <= 0 || t >= 1) {
            continue;
        }
        const segmentDistance = (cursor.x - a.x - t * dx) ** 2 + (cursor.y - a.y - t * dy) ** 2;
        if (segmentDistance < bestDistance) {
            bestDistance = segmentDistance;
            best = i + t;
        }
    }
    return best;
}
