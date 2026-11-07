import type { Feature, FeatureCollection, Point } from 'geojson';
import { distance } from './geometry';
import type { LatLng, Track } from './model';

// Distance ticks along segments (design add-web-search-panoramas, «Отметки расстояния и линейка»): L.MeasuredLine of
// the old client (src/lib/leaflet.polyline-measure/index.js): for each segment from its start, the step is the first
// value of the series that is not less than 15 mm of the screen, the label is across the line.

const STEPS = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
const MIN_TICKS_INTERVAL_MM = 15;
const DPI = 96;
// 20003931 / project([180, 0]).x of the old client: half of the meridian circumference per half of the world width; in
// MapLibre the world at z0 is 512 px
const MERIDIAN = 2 * 20003931;
const RAD = Math.PI / 180;
const EARTH_RADIUS = 6378137;

// meters per 15 mm of the screen at this latitude at the MapLibre zoom (updateTicks of the old client)
export function minTickInterval(zoom: number, lat: number): number {
    const metersPerPixel = (MERIDIAN / (512 * 2 ** zoom)) * Math.cos(lat * RAD);
    const mapScale = ((1 / DPI) * 2.54) / 100 / metersPerPixel;
    return MIN_TICKS_INTERVAL_MM / mapScale / 1000;
}

// first series step not less than the interval, otherwise the last one (getTicksPositions loop of the old client)
export function tickStep(minInterval: number): number {
    return STEPS.find((step) => step >= minInterval) ?? STEPS[STEPS.length - 1];
}

export interface Tick {
    lat: number;
    lng: number;
    // meters from the start of the segment
    distance: number;
    // label rotation clockwise, in degrees
    rotate: number;
}

function mercatorY(lat: number): number {
    return EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
}

// Rotation of a label across an edge: transformMatrix of the old client (sinCosFromLatLonSegment in Mercator, CSS
// matrix) as an angle: the rotation matrix [a, b, c, d] is [cos θ, sin θ, −sin θ, cos θ]
function rotation(a: LatLng, b: LatLng): number {
    const dx = (b.lng - a.lng) * RAD * EARTH_RADIUS;
    const dy = mercatorY(a.lat) - mercatorY(b.lat);
    const length = Math.hypot(dx, dy);
    if (!length) {
        return 0;
    }
    const sin = dy / length;
    const cos = dx / length;
    const [m0, m1] = sin > 0 ? [sin, -cos] : [-sin, cos];
    return Math.atan2(m1, m0) / RAD;
}

// FIXME from the author: the point is on a straight line in degrees, not in the projection
function pointAt(a: LatLng, b: LatLng, offset: number): LatLng {
    const q = offset / distance(a, b);
    return { lat: a.lat + (b.lat - a.lat) * q, lng: a.lng + (b.lng - a.lng) * q };
}

export function segmentTicks(points: readonly LatLng[], minInterval: number): Tick[] {
    if (points.length < 2) {
        return [];
    }
    const step = tickStep(minInterval);
    const ticks: Tick[] = [];
    const add = (at: LatLng, from: LatLng, to: LatLng, value: number) =>
        ticks.push({ lat: at.lat, lng: at.lng, distance: value, rotate: rotation(from, to) });
    let lastTick = 0;
    let lastPoint = 0;
    for (let i = 1; i < points.length; i++) {
        const next = lastPoint + distance(points[i - 1], points[i]);
        while (lastTick + step <= next) {
            lastTick += step;
            add(pointAt(points[i - 1], points[i], lastTick - lastPoint), points[i - 1], points[i], lastTick);
        }
        lastPoint = next;
    }
    // the last tick is near the end: remove it
    if (lastPoint - lastTick < minInterval / 2) {
        ticks.pop();
    }
    // a very short segment: no zero tick
    if (lastPoint > minInterval / 2) {
        add(points[0], points[0], points[1], 0);
    }
    add(points[points.length - 1], points[points.length - 2], points[points.length - 1], lastPoint);
    return ticks;
}

// label of the old client: round(d / 10) / 100 km
export function tickLabel(meters: number): string {
    return `${Math.round(meters / 10) / 100} km`;
}

function middleLat(points: readonly LatLng[]): number {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const { lat } of points) {
        min = Math.min(min, lat);
        max = Math.max(max, lat);
    }
    return (min + max) / 2;
}

const NO_TICKS: FeatureCollection<Point> = { type: 'FeatureCollection', features: [] };

// Ticks of the visible tracks with measureTicksShown at an integer MapLibre zoom; the scale is at the middle of the
// segment bounds. Without ticks, the same empty object: the map style is not built again on each zoom step
export function ticksData(tracks: readonly Track[], zoom: number): FeatureCollection<Point> {
    if (!tracks.some((track) => track.visible && track.measureTicksShown)) {
        return NO_TICKS;
    }
    const features: Feature<Point>[] = [];
    for (const track of tracks) {
        if (!track.visible || !track.measureTicksShown) {
            continue;
        }
        for (const points of track.segments) {
            if (points.length < 2) {
                continue;
            }
            for (const tick of segmentTicks(points, minTickInterval(zoom, middleLat(points)))) {
                features.push({
                    type: 'Feature',
                    properties: { label: tickLabel(tick.distance), rotate: tick.rotate },
                    geometry: { type: 'Point', coordinates: [tick.lng, tick.lat] },
                });
            }
        }
    }
    return features.length ? { type: 'FeatureCollection', features } : NO_TICKS;
}
