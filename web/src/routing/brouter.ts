import { distance, SIMPLIFY_TOLERANCE, simplify, wrapLng } from '@/tracks/geometry';
import type { LatLng } from '@/tracks/model';

// The BRouter request and the parse of the response into leg points (spec routing). Translation of
// src/lib/brouter/index.js of the old client: the same profiles, parameters, simplification and end point removal, the
// same error texts. The in-browser engine and the server BRouter understand one query string and return one GeoJSON
// (spec browser-routing-engine, «Паритет»).

export interface Activity {
    id: string;
    title: string;
    profile: string;
    // overrides of profile variables: profile:<name>=<value>
    params?: readonly (readonly [string, number])[];
}

export const ACTIVITIES: readonly Activity[] = [
    { id: 'hiking', title: 'Hiking', profile: 'hiking-mountain' },
    {
        id: 'hiking-trails',
        title: 'Hiking, prefer trails',
        profile: 'hiking-mountain',
        params: [['path_preference', 20]],
    },
    { id: 'road-bike', title: 'Road bike', profile: 'fastbike' },
    { id: 'gravel', title: 'Gravel bike', profile: 'gravel' },
    { id: 'mtb', title: 'Mountain bike', profile: 'mtb' },
    { id: 'touring-bike', title: 'Touring bike', profile: 'trekking' },
];

export function getActivity(id: string | null | undefined): Activity | null {
    return ACTIVITIES.find((activity) => activity.id === id) ?? null;
}

// A route end point nearer than this to its waypoint is dropped: the waypoint connects to the road without a small tail
const SNAP_DISTANCE = 20;
// BRouter (both engine and server) answers so when the area has no tile; the file name tells the user nothing
const MISSING_TILE_ERROR = /^datafile \S+\.rd5 not found$/u;

// A routing error. unreachable: the whole router is not available (the server does not answer, the engine did not
// start): for the UI this is a red button and one warning, not «Routing failed» for each leg.
export class RoutingError extends Error {
    override name = 'RoutingError';
    readonly unreachable: boolean;

    constructor(message: string, unreachable = false) {
        super(MISSING_TILE_ERROR.test(message) ? 'no routing data for this area' : message);
        this.unreachable = unreachable;
    }
}

function lonLat(point: LatLng): string {
    return `${wrapLng(point.lng).toFixed(6)},${point.lat.toFixed(6)}`;
}

// The BRouter query string: the main route (alternativeidx=0) in GeoJSON. The longitude is brought to [−180, 180]:
// MapLibre has world copies, and BRouter does not understand a point on a neighbor copy.
export function routeQuery(from: LatLng, to: LatLng, activity: Activity): string {
    const params = new URLSearchParams();
    params.set('lonlats', `${lonLat(from)}|${lonLat(to)}`);
    params.set('profile', activity.profile);
    for (const [name, value] of activity.params ?? []) {
        params.set(`profile:${name}`, String(value));
    }
    params.set('alternativeidx', '0');
    params.set('format', 'geojson');
    return params.toString();
}

// Leg points between the waypoints from and to (without them): the response moves to the world copy of from, is
// simplified with the import tolerance (≈ 2.4 m) and loses the end points nearer than 20 m to the waypoints
// (buildSegmentNodes of the old client).
export function parseRoute(geojson: string, from: LatLng, to: LatLng): LatLng[] {
    let coordinates: unknown;
    try {
        coordinates = JSON.parse(geojson)?.features?.[0]?.geometry?.coordinates;
    } catch {
        throw new RoutingError('invalid router response');
    }
    // empty route: an error, not an unmarked straight line (spec browser-routing-engine, «Пустой результат — ошибка»)
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        throw new RoutingError('no route found');
    }
    let prevLng = from.lng;
    const points = coordinates.map(([lng, lat]: [number, number]) => {
        const shifted = lng + 360 * Math.round((prevLng - lng) / 360);
        prevLng = shifted;
        return { lat, lng: shifted };
    });
    const nodes = simplify(points, SIMPLIFY_TOLERANCE);
    if (nodes.length && distance(from, nodes[0]) < SNAP_DISTANCE) {
        nodes.shift();
    }
    if (nodes.length && distance(to, nodes[nodes.length - 1]) < SNAP_DISTANCE) {
        nodes.pop();
    }
    return nodes;
}
