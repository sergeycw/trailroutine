import type { LineTool } from '@/state/store';
import type { LatLng } from '@/tracks/model';
import type { End } from './editor';
import { type Leg, legPath, type RouteLine, STRAIGHT } from './line';

// Line tools without a map and a store (design add-web-line-tools, «Операции — функции над линией редактора»): Cut,
// Join, Shortcut, segment reverse. They work on an immutable RouteLine, so the route markup (which legs are routed and
// with which activity) survives the operation by itself: the track keeps it as waypoint indexes, and
// fromSegment/toSegment calculate them again. Reference: splitTrackSegment, joinTrackSegments, getShortCutNodes in
// src/lib/leaflet.control.track-list/track-list.js.

// A place on the line: a waypoint or a point near the leg leg; it is projected onto the nearest link of this leg
export type LinePlace = { waypoint: number } | { leg: number; latlng: LatLng };

// The point of the link a–b nearest to p and the squared distance to it, in degrees with a longitude correction for
// latitude: this is enough to choose a link and a point on it, meter precision is not necessary
export function closestOnSegment(p: LatLng, a: LatLng, b: LatLng): { point: LatLng; sqDist: number } {
    const k = Math.cos((p.lat * Math.PI) / 180);
    const dx = (b.lng - a.lng) * k;
    const dy = b.lat - a.lat;
    const dot = dx * dx + dy * dy;
    let t = dot > 0 ? ((p.lng - a.lng) * k * dx + (p.lat - a.lat) * dy) / dot : 0;
    t = Math.max(0, Math.min(1, t));
    const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    return { point, sqDist: ((p.lng - point.lng) * k) ** 2 + (p.lat - point.lat) ** 2 };
}

// The link of the leg leg nearest to latlng: the link index in legPath and the projection onto it
export function nearestLink(line: RouteLine, leg: number, latlng: LatLng): { link: number; point: LatLng } {
    const path = legPath(line, leg);
    let link = 0;
    let best = Number.POSITIVE_INFINITY;
    let point = latlng;
    for (let k = 0; k < path.length - 1; k++) {
        const candidate = closestOnSegment(latlng, path[k], path[k + 1]);
        if (candidate.sqDist < best) {
            best = candidate.sqDist;
            link = k;
            point = candidate.point;
        }
    }
    return { link, point };
}

// A new waypoint point on the link link of the leg leg. A routed leg is split at the link, both halves are routed with
// the same activity, and the geometry does not change. A straight leg and an unrouted leg give two copies. A pending
// leg gives two copies with the same request number: their ends are new, the editor replaces them with new requests
// (renewPending in editor.ts), and list operations make them unrouted.
function splitAt(line: RouteLine, leg: number, link: number, point: LatLng): { line: RouteLine; index: number } {
    const { waypoints, legs } = line;
    const source = legs[leg];
    let left: Leg = source;
    let right: Leg = source;
    if (source.state === 'routed') {
        // the link path[link]–path[link + 1]; the inner route points are path[1..n−2]
        const path = legPath(line, leg);
        left = { ...source, points: path.slice(1, link + 1) };
        right = { ...source, points: path.slice(link + 1, -1) };
    }
    const index = leg + 1;
    return {
        line: {
            waypoints: [...waypoints.slice(0, index), point, ...waypoints.slice(index)],
            legs: [...legs.slice(0, leg), left, right, ...legs.slice(leg + 1)],
        },
        index,
    };
}

// A waypoint on the line where the user pressed: on the nearest link of the leg leg, not at the nearest line point
// (design, «Опорная точка — в месте клика на линии»). null: there is no such leg.
export function splitLeg(line: RouteLine, leg: number, latlng: LatLng): { line: RouteLine; index: number } | null {
    if (!line.legs[leg]) {
        return null;
    }
    const { link, point } = nearestLink(line, leg, latlng);
    return splitAt(line, leg, link, point);
}

// A waypoint from a place: a place on a leg becomes a new waypoint
function waypointAt(line: RouteLine, place: LinePlace): { line: RouteLine; index: number } | null {
    if ('waypoint' in place) {
        return line.waypoints[place.waypoint] ? { line, index: place.waypoint } : null;
    }
    return splitLeg(line, place.leg, place.latlng);
}

function slice(line: RouteLine, from: number, to: number): RouteLine {
    return { waypoints: line.waypoints.slice(from, to + 1), legs: line.legs.slice(from, to) };
}

// Cut: two lines, the shared point is the end of the first line and the start of the second line. At an end waypoint
// there is nothing to cut: null (the menu of the old client does not show Cut at end nodes).
export function cutLine(line: RouteLine, place: LinePlace): [RouteLine, RouteLine] | null {
    const split = waypointAt(line, place);
    if (!split || split.index <= 0 || split.index >= split.line.waypoints.length - 1) {
        return null;
    }
    const last = split.line.waypoints.length - 1;
    return [slice(split.line, 0, split.index), slice(split.line, split.index, last)];
}

function reverseLeg(leg: Leg): Leg {
    return leg.state === 'routed' ? { ...leg, points: leg.points.slice().reverse() } : leg;
}

export function reverseLine(line: RouteLine): RouteLine {
    return {
        waypoints: line.waypoints.slice().reverse(),
        legs: line.legs.map(reverseLeg).reverse(),
    };
}

// Join: other attaches with its end otherEnd to the end end of the line, the joint is a straight leg (joinTrackSegments
// of the old client)
// the index of the seam leg of joinLines: the straight leg between the two parts
export function joinSeam(line: RouteLine, end: End, other: RouteLine): number {
    return end === 'end' ? line.legs.length : other.legs.length;
}

export function joinLines(line: RouteLine, end: End, other: RouteLine, otherEnd: End): RouteLine {
    if (end === 'end') {
        const tail = otherEnd === 'start' ? other : reverseLine(other);
        return {
            waypoints: [...line.waypoints, ...tail.waypoints],
            legs: [...line.legs, STRAIGHT, ...tail.legs],
        };
    }
    const head = otherEnd === 'end' ? other : reverseLine(other);
    return {
        waypoints: [...head.waypoints, ...line.waypoints],
        legs: [...head.legs, STRAIGHT, ...line.legs],
    };
}

// The position of a place among all line points in sequence (toSegment): a point with index f has the key 2f, a place
// on the link between points f and f + 1 has 2f + 1. There is something to remove between two places if at least one
// even key lies between their keys.
interface Located {
    key: number;
    // a waypoint or a place on a leg: link and projection
    waypoint?: number;
    leg?: number;
    link?: number;
    point: LatLng;
}

function locate(line: RouteLine, place: LinePlace): Located | null {
    // the index of the first point of each leg among all line points
    const target = 'waypoint' in place ? place.waypoint : place.leg;
    let flat = 0;
    for (let i = 0; i < target; i++) {
        const leg = line.legs[i];
        flat += 1 + (leg?.state === 'routed' ? leg.points.length : 0);
    }
    if ('waypoint' in place) {
        const point = line.waypoints[place.waypoint];
        return point ? { key: 2 * flat, waypoint: place.waypoint, point } : null;
    }
    if (!line.legs[place.leg]) {
        return null;
    }
    const { link, point } = nearestLink(line, place.leg, place.latlng);
    return { key: 2 * (flat + link) + 1, leg: place.leg, link, point };
}

function ordered(line: RouteLine, from: LinePlace, to: LinePlace): [Located, Located] | null {
    const a = locate(line, from);
    const b = locate(line, to);
    if (!a || !b) {
        return null;
    }
    const [first, second] = a.key <= b.key ? [a, b] : [b, a];
    // at least one line point strictly between the places: an even key in (first.key, second.key)
    const firstEven = first.key % 2 === 0 ? first.key + 2 : first.key + 1;
    return firstEven < second.key ? [first, second] : null;
}

// Shortcut: the part between two line places becomes one straight leg. null: nothing to remove (getShortCutNodes:
// lastNodeToDelete < firstNodeToDelete). First the far place becomes a waypoint, then the near place: this does not
// shift the indexes of the near place.
export function shortcutLine(line: RouteLine, from: LinePlace, to: LinePlace): RouteLine | null {
    const range = ordered(line, from, to);
    if (!range) {
        return null;
    }
    const [first, second] = range;
    let next = line;
    let end: number;
    if (second.leg !== undefined && second.link !== undefined) {
        const split = splitAt(next, second.leg, second.link, second.point);
        next = split.line;
        end = split.index;
    } else {
        end = second.waypoint ?? 0;
    }
    let start: number;
    if (first.leg !== undefined && first.link !== undefined) {
        const split = splitAt(next, first.leg, first.link, first.point);
        next = split.line;
        start = split.index;
        end += 1;
    } else {
        start = first.waypoint ?? 0;
    }
    return {
        waypoints: [...next.waypoints.slice(0, start + 1), ...next.waypoints.slice(end)],
        legs: [...next.legs.slice(0, start), STRAIGHT, ...next.legs.slice(end)],
    };
}

// The part that Shortcut removes, for the highlight: from the first place to the second place along the line. null:
// nothing to remove.
export function shortcutRemoved(line: RouteLine, from: LinePlace, to: LinePlace): LatLng[] | null {
    const range = ordered(line, from, to);
    if (!range) {
        return null;
    }
    const [first, second] = range;
    const points: LatLng[] = [first.point];
    let flat = 0;
    const visit = (point: LatLng) => {
        const key = 2 * flat;
        if (key > first.key && key < second.key) {
            points.push(point);
        }
        flat += 1;
    };
    line.waypoints.forEach((waypoint, i) => {
        visit(waypoint);
        const leg = line.legs[i];
        if (leg?.state === 'routed') {
            for (const point of leg.points) {
                visit(point);
            }
        }
    });
    points.push(second.point);
    return points;
}

// the point of a place on the line: a waypoint or a projection onto the nearest link
export function placePoint(line: RouteLine, place: LinePlace): LatLng | null {
    if ('waypoint' in place) {
        return line.waypoints[place.waypoint] ?? null;
    }
    return line.legs[place.leg] ? nearestLink(line, place.leg, place.latlng).point : null;
}

// Where the map choice starts: the line end for Join, a place on the line for Shortcut. The choice line goes from this
// point, and the hint stands at it (ToolHintOnMap)
export function toolOrigin(line: RouteLine, tool: LineTool): LatLng | null {
    if (tool.kind === 'join') {
        return (tool.end === 'end' ? line.waypoints.at(-1) : line.waypoints[0]) ?? null;
    }
    return placePoint(line, tool.from);
}
