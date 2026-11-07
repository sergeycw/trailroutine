import { simplify, unwrapLine } from '@/tracks/geometry';
import type { LatLng } from '@/tracks/model';

// The editor line model (design add-web-route-editor, «Модель линии»): waypoints and legs between them, not a flat
// array of nodes with a leg mark on each node, as in the old editor (leaflet.polyline-edit). The data is immutable: an
// edit gives a new object, and a stale router response is cut off because its request is no longer in any leg.

export type Leg =
    | { state: 'straight' }
    // points: route points between the waypoints, without the waypoints themselves
    | { state: 'routed'; activity: string; points: readonly LatLng[] }
    | { state: 'pending'; activity: string; request: number }
    // an unrouted leg: a straight line with a mark, the activity stays for a retry (owner decision, spec routing)
    | { state: 'failed'; activity: string };

export interface RouteLine {
    waypoints: readonly LatLng[];
    // legs.length === waypoints.length − 1 (a line of one point has no legs)
    legs: readonly Leg[];
}

// Route markup in a track, one per track segment (TrackData.routes): the waypoint indexes in the segment and the state
// of the legs between them without points; the points themselves are in segments. Indexes, not coordinates
// (applyRouteMarkup of the old client matched on a grid of ~2.4 m): the nktk link and autosave write the markup next to
// the geometry, and the line simplification does not touch waypoints (simplifyRouted below, design add-web-autosave).
export type LegMark = { state: 'straight' } | { state: 'routed' | 'pending' | 'failed'; activity: string };

export interface SegmentRoute {
    waypoints: readonly number[];
    legs: readonly LegMark[];
}

export const STRAIGHT: Leg = { state: 'straight' };

const MARK_STATES = new Set(['straight', 'routed', 'pending', 'failed']);

// The markup shape from outside (an IndexedDB record): arrays of integer indexes and legs with a known state and an
// activity string. Without this check, garbage in the database would throw an exception in the middle of the restore.
export function isRouteShape(value: unknown): value is SegmentRoute {
    const route = value as SegmentRoute | null;
    return (
        typeof route === 'object' &&
        route !== null &&
        Array.isArray(route.waypoints) &&
        route.waypoints.every(Number.isInteger) &&
        Array.isArray(route.legs) &&
        route.legs.every(
            (leg) =>
                typeof leg === 'object' &&
                leg !== null &&
                MARK_STATES.has(leg.state) &&
                (leg.state === 'straight' || typeof leg.activity === 'string'),
        )
    );
}

export function hasActivity(leg: Leg | LegMark): leg is Exclude<Leg, { state: 'straight' }> {
    return leg.state !== 'straight';
}

function plainLine(points: readonly LatLng[]): RouteLine {
    return { waypoints: points.slice(), legs: points.slice(1).map(() => STRAIGHT) };
}

// The markup is valid if the waypoints are increasing indexes from the first to the last point of the segment, and legs
// without route points (straight, pending, unrouted) have no intermediate nodes. The markup from an nktk link and from
// autosave goes through this same function: an invalid markup is dropped, and the segment stays a polyline. External
// input (an nktk link, a database record) first goes through isRouteShape: routeFits relies on the shape.
export function routeFits(points: readonly LatLng[], route: SegmentRoute): boolean {
    const { waypoints, legs } = route;
    if (waypoints.length === 0 || waypoints[0] !== 0 || waypoints.at(-1) !== points.length - 1) {
        return false;
    }
    // a markup without a single leg with an activity is the same polyline: toSegment does not write it, and we do not
    // accept it from outside
    if (legs.length !== waypoints.length - 1 || !legs.some((leg) => leg?.state !== 'straight')) {
        return false;
    }
    return legs.every((leg, i) => {
        const gap = waypoints[i + 1] - waypoints[i];
        return leg.state === 'routed' ? gap >= 1 : gap === 1;
    });
}

// Track segment + markup → editor line. Without valid markup, each point is a waypoint and all legs are straight: the
// old editor opened an imported line like this. A pending leg without a live request becomes unrouted.
export function fromSegment(points: readonly LatLng[], route?: SegmentRoute | null): RouteLine {
    if (!route || !routeFits(points, route)) {
        return plainLine(points);
    }
    const { waypoints, legs } = route;
    return {
        waypoints: waypoints.map((index) => points[index]),
        legs: legs.map((mark, i): Leg => {
            if (mark.state === 'routed') {
                return {
                    state: 'routed',
                    activity: mark.activity,
                    points: points.slice(waypoints[i] + 1, waypoints[i + 1]),
                };
            }
            if (mark.state === 'straight') {
                return STRAIGHT;
            }
            return { state: 'failed', activity: mark.activity };
        }),
    };
}

// Line → track segment points and markup. The markup is null if all legs are straight: a plain polyline has none.
export function toSegment(line: RouteLine): { points: LatLng[]; route: SegmentRoute | null } {
    const points: LatLng[] = [];
    const waypoints: number[] = [];
    line.waypoints.forEach((waypoint, i) => {
        waypoints.push(points.length);
        points.push(waypoint);
        const leg = line.legs[i];
        if (leg?.state === 'routed') {
            points.push(...leg.points);
        }
    });
    if (!line.legs.some(hasActivity)) {
        return { points, route: null };
    }
    const legs = line.legs.map(
        (leg): LegMark => (hasActivity(leg) ? { state: leg.state, activity: leg.activity } : leg),
    );
    return { points, route: { waypoints, legs } };
}

// Does the track segment wait for a router response on any leg: the elevation profile skips it, settledRoute clears it
export function routePending(route: SegmentRoute | null | undefined): boolean {
    return route?.legs.some((leg) => leg.state === 'pending') ?? false;
}

// Does the router wait for at least one leg of at least one track: the badge at the mouse pointer over the map
// (RoutingBadgeOnMap.tsx) and the thread RouteThread.tsx on the routing button and on Tracks. By tracks, not by the
// editor: Finish editing and Escape do not cancel the request (design drop-route-spinner and editor-routing-indicator)
export function tracksRouting(tracks: readonly { routes?: readonly (SegmentRoute | null)[] }[]): boolean {
    return tracks.some((track) => track.routes?.some(routePending));
}

// Markup without live requests: a pending leg becomes unrouted. A track copy and a reversed track are new segment
// arrays, the editor does not recognize them, and the response to the old request will not come to them: without this,
// the copy would keep a gap and the routing wait (tracksRouting) forever.
export function settledRoute(route: SegmentRoute | null | undefined): SegmentRoute | null {
    if (!route) {
        return null;
    }
    if (!routePending(route)) {
        return route;
    }
    return {
        waypoints: route.waypoints,
        legs: route.legs.map((leg) => (leg.state === 'pending' ? { state: 'failed', activity: leg.activity } : leg)),
    };
}

// Markup of a segment reversed back to front (Reverse): index i → n − 1 − i, legs in the reverse order
export function reverseRoute(route: SegmentRoute | null | undefined, length: number): SegmentRoute | null {
    const settled = settledRoute(route);
    if (!settled) {
        return null;
    }
    return {
        waypoints: settled.waypoints.map((index) => length - 1 - index).reverse(),
        legs: settled.legs.slice().reverse(),
    };
}

// Leg points between the waypoints i and i + 1 with the ends (for drawing and the search of the link under the cursor)
export function legPath(line: RouteLine, i: number): LatLng[] {
    const leg = line.legs[i];
    const inner = leg.state === 'routed' ? leg.points : [];
    return [line.waypoints[i], ...inner, line.waypoints[i + 1]];
}

// All line points in sequence
export function linePoints(line: RouteLine): LatLng[] {
    return toSegment(line).points;
}

// Simplification of a segment with markup (simplifyKeepingWaypoints of the old client): the line unwraps across 180° as
// a whole, each routed leg is simplified separately together with its waypoint ends, and the waypoint indexes are
// calculated again. Waypoints do not take part in the filtering, so the markup stays correct (design add-web-autosave,
// «Упрощение линии не трогает опорные точки»). null: there is no markup or it is invalid, and such a segment is
// simplified as a plain polyline.
export function simplifyRouted(
    points: readonly LatLng[],
    route: SegmentRoute | null | undefined,
): { points: LatLng[]; route: SegmentRoute } | null {
    const settled = settledRoute(route);
    if (!settled || !routeFits(points, settled)) {
        return null;
    }
    const line = unwrapLine(points);
    const result = [line[0]];
    const waypoints = [0];
    settled.legs.forEach((leg, i) => {
        const from = settled.waypoints[i];
        const to = settled.waypoints[i + 1];
        const path = leg.state === 'routed' ? simplify(line.slice(from, to + 1)) : [line[from], line[to]];
        result.push(...path.slice(1));
        waypoints.push(result.length - 1);
    });
    return { points: result, route: { waypoints, legs: settled.legs } };
}
