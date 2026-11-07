import type { LatLng } from '@/tracks/model';
import { hasActivity, type Leg, type RouteLine, STRAIGHT } from './line';
import { type LinePlace, reverseLine, shortcutLine, splitLeg } from './line-tools';
import { trimSpur } from './spur';

// The editor of one line without a map (design add-web-route-editor, «Редактор — модель с очередью и историей»; spec
// route-editing). Edits place waypoints immediately, and legs with an activity go to the router asynchronously: a leg
// waits with its request number, and a response applies only if this number is still in the line; otherwise the leg was
// dragged, removed or undone, and the response is dropped without a message («Устаревшие ответы отбрасываются»). The
// queue of the calculations is in the engine (engine.ts), here there is only cancellation: an AbortController cancels a
// request whose leg left the line.

export type End = 'start' | 'end';

export type RouteFn = (from: LatLng, to: LatLng, activity: string, signal: AbortSignal) => Promise<LatLng[]>;

export interface RouteEditorOptions {
    route: RouteFn;
    // the line changed: an edit, a router response, undo/redo
    onChange?: (line: RouteLine) => void;
    // a leg is not routed: a router error (a cancellation does not come here)
    onRouteError?: (error: unknown) => void;
    // a leg is routed: the router is alive
    onRouted?: () => void;
}

export interface RouteEditor {
    line(): RouteLine;
    // a new waypoint at the end; activity null gives a straight leg («Off» or Alt-click)
    addWaypoint(end: End, latlng: LatLng, activity: string | null): void;
    // Backspace while drawing: the end waypoint goes away together with its leg
    removeEndWaypoint(end: End): void;
    moveWaypoint(index: number, latlng: LatLng): void;
    // a double click on a waypoint
    removeWaypoint(index: number): void;
    // a press on the leg legIndex returns the new waypoint index; a drag right after it is the same history step
    insertWaypoint(legIndex: number, latlng: LatLng): number;
    // Shortcut (design add-web-line-tools): the part between places becomes a straight leg; false: nothing to remove
    shortcut(from: LinePlace, to: LinePlace): boolean;
    // Reverse of the segment from the menu: the line back to front together with the markup
    reverse(): void;
    // a straight leg goes to the router with the activity, without a history step, as a response does (the seam of Join)
    routeLeg(index: number, activity: string): void;
    undo(): void;
    redo(): void;
    canUndo(): boolean;
    canRedo(): boolean;
    // how many legs wait for a route; only editor.test.ts reads it (the wait indicator reads tracksRouting in line.ts)
    pending(): number;
    // the edit number: it grows on each edit, undo and redo, but not on a router response. A response also moves a
    // waypoint (a spur at a turn, spur.ts), so the MapEditor gesture checks by the number, not by the point, whether
    // the line under it changed
    revision(): number;
    // cancel all requests: the editor is not necessary any more
    dispose(): void;
}

// History has up to 100 steps, as in the old editor (_historyLimit)
export const HISTORY_LIMIT = 100;

let lastRequest = 0;

function pendingLeg(activity: string): Leg {
    lastRequest += 1;
    return { state: 'pending', activity, request: lastRequest };
}

// A leg after its end moved: with an activity, it is routed again with its activity; a straight leg stays straight
function rerouted(leg: Leg | undefined): Leg {
    return leg && hasActivity(leg) ? pendingLeg(leg.activity) : STRAIGHT;
}

// Pending legs that have other ends after an edit (point insertion, Shortcut, reverse) get new requests: the response
// to the old request was calculated between other points. A leg with the same request and the same ends keeps waiting
// for its response.
function renewPending(prev: RouteLine, next: RouteLine): RouteLine {
    const ends = new Map<number, [LatLng, LatLng]>();
    prev.legs.forEach((leg, i) => {
        if (leg.state === 'pending') {
            ends.set(leg.request, [prev.waypoints[i], prev.waypoints[i + 1]]);
        }
    });
    const kept = new Set<number>();
    let changed = false;
    const legs = next.legs.map((leg, i) => {
        if (leg.state !== 'pending') {
            return leg;
        }
        const old = ends.get(leg.request);
        if (old && !kept.has(leg.request) && old[0] === next.waypoints[i] && old[1] === next.waypoints[i + 1]) {
            kept.add(leg.request);
            return leg;
        }
        changed = true;
        return pendingLeg(leg.activity);
    });
    return changed ? { waypoints: next.waypoints, legs } : next;
}

export function createRouteEditor(initial: RouteLine, options: RouteEditorOptions): RouteEditor {
    let line: RouteLine = initial;
    let undoStack: RouteLine[] = [];
    let redoStack: RouteLine[] = [];
    // the index of the point that was just inserted on a leg: its drag is the same history step (_justInsertedNode)
    let justInserted: number | null = null;
    let revision = 0;
    const requests = new Map<number, AbortController>();

    function pendingRequests(target: RouteLine): Set<number> {
        const ids = new Set<number>();
        for (const leg of target.legs) {
            if (leg.state === 'pending') {
                ids.add(leg.request);
            }
        }
        return ids;
    }

    // A new line: requests whose legs are no longer in it are cancelled; new pending legs go to the router
    function setLine(next: RouteLine) {
        line = next;
        const live = pendingRequests(next);
        for (const [id, controller] of requests) {
            if (!live.has(id)) {
                controller.abort();
                requests.delete(id);
            }
        }
        next.legs.forEach((leg, i) => {
            if (leg.state === 'pending' && !requests.has(leg.request)) {
                request(leg.request, leg.activity, next.waypoints[i], next.waypoints[i + 1]);
            }
        });
        options.onChange?.(line);
    }

    function request(id: number, activity: string, from: LatLng, to: LatLng) {
        const controller = new AbortController();
        requests.set(id, controller);
        options.route(from, to, activity, controller.signal).then(
            (points) => {
                if (controller.signal.aborted) {
                    return;
                }
                requests.delete(id);
                options.onRouted?.();
                applyResponse(id, { state: 'routed', activity, points });
            },
            (error: unknown) => {
                if (controller.signal.aborted) {
                    return;
                }
                requests.delete(id);
                applyResponse(id, { state: 'failed', activity });
                options.onRouteError?.(error);
            },
        );
    }

    // A response changes only its own leg and does not go to the history: undo cancels an edit, not the arrival of a
    // route. A routed leg can give a spur at its ends with a neighbor routed leg: the waypoint moves to the turn
    // (spur.ts), also without a history step, because this is part of the response
    function applyResponse(id: number, leg: Leg) {
        const index = line.legs.findIndex((item) => item.state === 'pending' && item.request === id);
        if (index < 0) {
            return;
        }
        const legs = line.legs.slice();
        legs[index] = leg;
        let next: RouteLine = { waypoints: line.waypoints, legs };
        if (leg.state === 'routed') {
            next = trimSpur(next, index) ?? next;
            next = trimSpur(next, index + 1) ?? next;
        }
        line = next;
        options.onChange?.(line);
    }

    // An edit: the previous line goes to the history, redo is cleared
    function edit(next: RouteLine) {
        justInserted = null;
        revision += 1;
        undoStack.push(line);
        if (undoStack.length > HISTORY_LIMIT) {
            undoStack.shift();
        }
        redoStack = [];
        setLine(next);
    }

    // A snapshot from the history: its pending legs are requested again («Отмена при ожидающем запросе»)
    function restore(snapshot: RouteLine) {
        justInserted = null;
        revision += 1;
        setLine({
            waypoints: snapshot.waypoints,
            legs: snapshot.legs.map((leg) => (leg.state === 'pending' ? pendingLeg(leg.activity) : leg)),
        });
    }

    return {
        line: () => line,

        addWaypoint(end, latlng, activity) {
            const { waypoints, legs } = line;
            if (waypoints.length === 0) {
                edit({ waypoints: [latlng], legs: [] });
                return;
            }
            const leg = activity ? pendingLeg(activity) : STRAIGHT;
            edit(
                end === 'end'
                    ? { waypoints: [...waypoints, latlng], legs: [...legs, leg] }
                    : { waypoints: [latlng, ...waypoints], legs: [leg, ...legs] },
            );
        },

        removeEndWaypoint(end) {
            const { waypoints, legs } = line;
            if (waypoints.length < 2) {
                return;
            }
            edit(
                end === 'end'
                    ? { waypoints: waypoints.slice(0, -1), legs: legs.slice(0, -1) }
                    : { waypoints: waypoints.slice(1), legs: legs.slice(1) },
            );
        },

        moveWaypoint(index, latlng) {
            const { waypoints, legs } = line;
            const old = waypoints[index];
            if (!old || (old.lat === latlng.lat && old.lng === latlng.lng)) {
                return;
            }
            const next = {
                waypoints: waypoints.map((point, i) => (i === index ? latlng : point)),
                legs: legs.map((leg, i) => (i === index - 1 || i === index ? rerouted(leg) : leg)),
            };
            if (justInserted === index) {
                // insertion and drag are one step: the snapshot before the insertion is already in the history
                justInserted = null;
                setLine(next);
                return;
            }
            edit(next);
        },

        removeWaypoint(index) {
            const { waypoints, legs } = line;
            if (!waypoints[index] || waypoints.length < 2) {
                return;
            }
            const before = legs[index - 1];
            const after = legs[index];
            if (!before || !after) {
                // the end point goes away together with its leg
                edit({
                    waypoints: waypoints.filter((_, i) => i !== index),
                    legs: index === 0 ? legs.slice(1) : legs.slice(0, -1),
                });
                return;
            }
            // one leg between the neighbors with the activity of a neighbor leg; without an activity, a straight leg
            const source = hasActivity(before) ? before : after;
            const merged = hasActivity(source) ? pendingLeg(source.activity) : STRAIGHT;
            edit({
                waypoints: waypoints.filter((_, i) => i !== index),
                legs: [...legs.slice(0, index - 1), merged, ...legs.slice(index + 1)],
            });
        },

        insertWaypoint(legIndex, latlng) {
            // The new point goes to the link nearest to the press, not to the press point: a hit on the line counts
            // within a few pixels of it, and without the projection the line would get a bend. The geometry does not
            // change until the point is moved.
            const split = splitLeg(line, legIndex, latlng);
            if (!split) {
                return -1;
            }
            edit(renewPending(line, split.line));
            justInserted = split.index;
            return split.index;
        },

        shortcut(from, to) {
            const next = shortcutLine(line, from, to);
            if (!next) {
                return false;
            }
            edit(renewPending(line, next));
            return true;
        },

        routeLeg(index, activity) {
            if (line.legs[index]?.state !== 'straight') {
                return;
            }
            const legs = line.legs.slice();
            legs[index] = pendingLeg(activity);
            setLine({ waypoints: line.waypoints, legs });
        },

        reverse() {
            if (line.waypoints.length < 2) {
                return;
            }
            edit(renewPending(line, reverseLine(line)));
        },

        undo() {
            const snapshot = undoStack.pop();
            if (!snapshot) {
                return;
            }
            redoStack.push(line);
            restore(snapshot);
        },

        redo() {
            const snapshot = redoStack.pop();
            if (!snapshot) {
                return;
            }
            undoStack.push(line);
            restore(snapshot);
        },

        canUndo: () => undoStack.length > 0,
        canRedo: () => redoStack.length > 0,
        pending: () => line.legs.filter((leg) => leg.state === 'pending').length,
        revision: () => revision,

        dispose() {
            for (const controller of requests.values()) {
                controller.abort();
            }
            requests.clear();
            undoStack = [];
            redoStack = [];
        },
    };
}
