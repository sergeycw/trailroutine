import type { LatLng } from '@/tracks/model';
import { legPath, type RouteLine } from './line';

// A spur at a turn (design snap-waypoint-to-turn, spec route-editing, «Опорная точка у поворота»): the waypoint is
// placed a little past the crossroads, and the route goes to it and comes back the same way. Each leg is routed
// separately, and the spur is visible only at the joint of two legs: parseRoute does not see it. Here the code finds it
// by geometry, and the waypoint moves to the turn. Shared nodes of the responses do not work: the simplification drops
// the crossroads from the leg that goes straight through it.

// A shorter spur is a click miss (a finger ±10–20 px at zoom 15–16 ≈ 10–35 m), a longer one is an intended out-and-back
export const SPUR_LIMIT = 30;
// Paths nearer than this count as one road: the leg simplification moves away from the road by not more than ≈ 2.4 m
const TOLERANCE = 3;
const STEP = 1;
// Path length to examine from the waypoint: the spur limit plus a margin, so spur points compare with a whole part
const REACH = SPUR_LIMIT + 10;
// A route that comes back leaves the waypoint in the same direction as it came: the angle between the paths is less
// than 45°. Without this check, a through route (angle ≈ 180°) with a bend a few meters from the point would also count
// as a spur: in the first meters, any two paths from one point lie within TOLERANCE of each other.
const SAME_SIDE = Math.cos(Math.PI / 4);

const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;

interface XY {
    x: number;
    y: number;
}

// The path from the waypoint in local meters around it (a spur is tens of meters, a flat approximation is enough)
interface Path {
    points: readonly LatLng[];
    xy: XY[];
    // path length from the waypoint to each vertex
    arc: number[];
}

function makePath(points: readonly LatLng[], origin: LatLng): Path {
    const k = Math.cos(origin.lat * RAD);
    const xy = points.map((p) => ({
        x: (p.lng - origin.lng) * RAD * EARTH_RADIUS * k,
        y: (p.lat - origin.lat) * RAD * EARTH_RADIUS,
    }));
    const arc = [0];
    for (let i = 1; i < xy.length; i++) {
        arc.push(arc[i - 1] + Math.hypot(xy[i].x - xy[i - 1].x, xy[i].y - xy[i - 1].y));
    }
    return { points, xy, arc };
}

// The nearest point of the path part up to REACH: the link index and the distance
function nearest(p: XY, path: Path): { link: number; dist: number } {
    let best = { link: 0, dist: Number.POSITIVE_INFINITY };
    for (let i = 0; i < path.xy.length - 1 && path.arc[i] <= REACH; i++) {
        const a = path.xy[i];
        const b = path.xy[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = dx * dx + dy * dy;
        const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
        const dist = Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
        if (dist < best.dist) {
            best = { link: i, dist };
        }
    }
    return best;
}

function pointAt(path: Path, s: number): XY {
    const i = path.arc.findIndex((value) => value >= s);
    if (i <= 0) {
        return i === 0 ? path.xy[0] : path.xy[path.xy.length - 1];
    }
    const t = (s - path.arc[i - 1]) / (path.arc[i] - path.arc[i - 1]);
    const a = path.xy[i - 1];
    const b = path.xy[i];
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// How many meters of path from the waypoint lie on other. Infinity: the paths do not part before the end of path or
// before REACH: this is a return along the whole leg or a long detour, not a spur.
function overlap(path: Path, other: Path): number {
    const length = path.arc[path.arc.length - 1];
    let covered = 0;
    for (let s = STEP; s <= REACH; s += STEP) {
        if (s >= length) {
            return Number.POSITIVE_INFINITY;
        }
        if (nearest(pointAt(path, s), other).dist > TOLERANCE) {
            return covered;
        }
        covered = s;
    }
    return Number.POSITIVE_INFINITY;
}

// The turn: the vertex of both paths that is farthest from the waypoint inside the overlap and lies on the other path.
// Usually this is the crossroads node: one of the paths always has it, there the route changes direction.
function turnOf(a: Path, b: Path, overlapA: number, overlapB: number): { point: LatLng; arc: number } | null {
    let turn: { point: LatLng; arc: number } | null = null;
    for (const [path, other, covered] of [
        [a, b, overlapA],
        [b, a, overlapB],
    ] as const) {
        // the last vertex is the far waypoint of the leg, it is not a turn
        for (let i = 1; i < path.points.length - 1 && path.arc[i] <= covered; i++) {
            if ((!turn || path.arc[i] > turn.arc) && nearest(path.xy[i], other).dist <= TOLERANCE) {
                turn = { point: path.points[i], arc: path.arc[i] };
            }
        }
    }
    return turn;
}

// The paths leave the waypoint in one direction: directions to the points at TOLERANCE from it
function sameSide(a: Path, b: Path): boolean {
    const pa = pointAt(a, TOLERANCE);
    const pb = pointAt(b, TOLERANCE);
    const la = Math.hypot(pa.x, pa.y);
    const lb = Math.hypot(pb.x, pb.y);
    return la > 0 && lb > 0 && (pa.x * pb.x + pa.y * pb.y) / (la * lb) > SAME_SIDE;
}

// Path points past the turn projection on the path, without the far waypoint and points nearer than TOLERANCE to the
// turn: after simplification, the crossroads copy in the other leg lies near the turn and would give a tooth
function beyond(path: Path, turn: LatLng, origin: LatLng): LatLng[] {
    const [t] = makePath([turn], origin).xy;
    let first = nearest(t, path).link + 1;
    while (first < path.xy.length - 1 && Math.hypot(path.xy[first].x - t.x, path.xy[first].y - t.y) < TOLERANCE) {
        first += 1;
    }
    return path.points.slice(first, -1);
}

// The line where the waypoint index moved to the turn and the spur is removed from both neighbor legs; null: there is
// no spur. Only for a point between two routed legs: a straight leg and a pending leg do not carry route geometry.
export function trimSpur(line: RouteLine, index: number): RouteLine | null {
    const before = line.legs[index - 1];
    const after = line.legs[index];
    if (before?.state !== 'routed' || after?.state !== 'routed') {
        return null;
    }
    const origin = line.waypoints[index];
    const back = makePath(legPath(line, index - 1).reverse(), origin);
    const ahead = makePath(legPath(line, index), origin);
    if (!sameSide(back, ahead)) {
        return null;
    }
    const overlapBack = overlap(back, ahead);
    const overlapAhead = overlap(ahead, back);
    if (!Number.isFinite(overlapBack) || !Number.isFinite(overlapAhead)) {
        return null;
    }
    const turn = turnOf(back, ahead, overlapBack, overlapAhead);
    if (!turn || turn.arc > SPUR_LIMIT) {
        return null;
    }
    const legs = line.legs.slice();
    legs[index - 1] = { ...before, points: beyond(back, turn.point, origin).reverse() };
    legs[index] = { ...after, points: beyond(ahead, turn.point, origin) };
    return {
        waypoints: line.waypoints.map((point, i) => (i === index ? turn.point : point)),
        legs,
    };
}
