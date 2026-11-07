import type { RoutingEngine } from '@/config';
import type { AppStore, MenuTarget } from '@/state/store';
import { prepareImport } from '@/tracks/import-result';
import { type GeoData, geoData, type LatLng, type Track } from '@/tracks/model';
import { saveActivity } from './activity';
import { getActivity, RoutingError } from './brouter';
import { createRouteEditor, type End, type RouteEditor } from './editor';
import { fromSegment, type RouteLine, type SegmentRoute, settledRoute, toSegment } from './line';
import { cutLine, joinLines, type LinePlace } from './line-tools';
import { type Router, routerDownHint } from './router';

// The connection between the editor and the store, without React, as createTrackActions (design add-web-route-editor,
// «Связь со стором и картой»). An editor lives longer than editing: after the exit it waits for router responses and
// keeps the history («История переживает выход из редактирования»). Editors are keyed by the point array of the segment
// that they last wrote to the track: any external change (reverse, track removal, a new track from a file) gives a
// different array, and such an editor is discarded: otherwise its response would overwrite another edit, and the
// history would belong to a different line.

export type Notify = (title: string, type?: 'error' | 'success') => void;

export interface RouteEditingDeps {
    store: AppStore;
    router: Router;
    engine: RoutingEngine;
    notify: Notify;
    storage: Storage | null;
}

interface Session {
    trackId: string;
    editor: RouteEditor;
    // the point array of the segment that the editor last wrote to the track
    written: readonly LatLng[];
}

export function createRouteEditing({ store, router, engine, notify, storage }: RouteEditingDeps) {
    const state = () => store.getState();
    const sessions = new WeakMap<readonly LatLng[], Session>();
    let current: Session | null = null;
    let drawing: End | null = null;

    function findSegment(session: Session): { track: Track; index: number } | null {
        const track = state().tracks.find((item) => item.id === session.trackId);
        const index = track?.segments.indexOf(session.written as LatLng[]) ?? -1;
        return track && index >= 0 ? { track, index } : null;
    }

    function publish() {
        const located = current && findSegment(current);
        if (!current || !located) {
            state().setRouteEdit(null);
            return;
        }
        state().setRouteEdit({
            trackId: current.trackId,
            segment: located.index,
            line: current.editor.line(),
            drawing,
            canUndo: current.editor.canUndo(),
            canRedo: current.editor.canRedo(),
            revision: current.editor.revision(),
        });
    }

    // The line changed (an edit or a router response, also after the exit): write segment and markup to the track
    function write(session: Session) {
        const located = findSegment(session);
        if (!located) {
            discard(session);
            return;
        }
        const { track, index } = located;
        const { points, route } = toSegment(session.editor.line());
        sessions.delete(session.written);
        session.written = points;
        sessions.set(points, session);
        const segments = track.segments.slice();
        segments[index] = points;
        const routes = segments.map((_, i) => (i === index ? route : (track.routes?.[i] ?? null)));
        state().updateTrack(track.id, { segments, routes });
        if (session === current) {
            publish();
        }
    }

    function discard(session: Session) {
        sessions.delete(session.written);
        session.editor.dispose();
        if (session === current) {
            current = null;
            drawing = null;
            state().setRouteDrag(null);
            closeTools();
            publish();
        }
    }

    // the map choice and the menu belong to the edited line: without the line they do not exist
    function closeTools() {
        if (state().lineTool) {
            state().setLineTool(null);
        }
        if (state().mapMenu?.target.kind !== 'point' && state().mapMenu) {
            state().setMapMenu(null);
        }
    }

    function onRouteError(error: unknown) {
        if (error instanceof RoutingError && error.unreachable) {
            // one warning per change from «worked» to «failed» (spec routing, «Недоступный роутер»)
            if (state().routerReachable) {
                state().setRouterReachable(false);
                notify(`${routerDownHint(engine)}. Lines stay straight until then.`, 'error');
            }
            return;
        }
        notify(`Routing failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }

    function session(trackId: string, points: readonly LatLng[], route: SegmentRoute | null) {
        const existing = sessions.get(points);
        if (existing && existing.trackId === trackId) {
            return existing;
        }
        const created: Session = {
            trackId,
            written: points,
            editor: createRouteEditor(fromSegment(points, route), {
                route: (from, to, activityId, signal) => {
                    const activity = getActivity(activityId);
                    if (!activity) {
                        return Promise.reject(new RoutingError(`unknown activity ${activityId}`));
                    }
                    return router.route(from, to, activity, signal);
                },
                onChange: () => write(created),
                onRouteError,
                onRouted: () => state().setRouterReachable(true),
            }),
        };
        sessions.set(points, created);
        return created;
    }

    // A segment with fewer than two points is removed, and so is a track without segments and points (onLineEditEnd of
    // the old client)
    function cleanUp(finished: Session) {
        const located = findSegment(finished);
        if (!located) {
            return;
        }
        const { track, index } = located;
        if (track.segments[index].length >= 2) {
            return;
        }
        sessions.delete(finished.written);
        finished.editor.dispose();
        const segments = track.segments.filter((_, i) => i !== index);
        if (segments.length === 0 && track.points.length === 0) {
            state().removeTracks([track.id]);
            return;
        }
        state().updateTrack(track.id, {
            segments,
            routes: segments.map((_, i) => track.routes?.[i < index ? i : i + 1] ?? null),
        });
    }

    function stop() {
        const finished = current;
        current = null;
        drawing = null;
        state().setRouteDrag(null);
        closeTools();
        publish();
        if (finished) {
            cleanUp(finished);
        }
    }

    function start(trackId: string, segment: number, startDrawing: End | null = null) {
        const track = state().tracks.find((item) => item.id === trackId);
        const points = track?.segments[segment];
        if (!track || !points) {
            return;
        }
        const next = session(trackId, points, track.routes?.[segment] ?? null);
        if (current && current !== next) {
            stop();
        }
        // line editing and placing track points exclude each other (_beginPointEdit of the old client)
        if (state().pointTool) {
            state().setPointTool(null);
        }
        current = next;
        drawing = startDrawing;
        publish();
    }

    // The track was hidden, removed or changed from outside during editing: editing ends
    store.subscribe((next, prev) => {
        // the track point mode ends if its track or the moved point is removed: the mode has no panel any more, and it
        // would take map clicks without a message (diff review)
        const tool = next.pointTool;
        if (tool && next.tracks !== prev.tracks) {
            const track = next.tracks.find((item) => item.id === tool.trackId);
            if (!track || (tool.kind === 'move' && !track.points.includes(tool.point))) {
                state().setPointTool(null);
                return;
            }
        }
        if (current && next.pointTool && !prev.pointTool) {
            stop();
            return;
        }
        if (!current || next.tracks === prev.tracks) {
            return;
        }
        const located = findSegment(current);
        if (!located) {
            discard(current);
        } else if (!located.track.visible) {
            stop();
        }
    });

    const editor = () => current?.editor ?? null;

    // A track segment from the line of a list operation: pending legs become unrouted, no editor knows their new array,
    // and no response comes (design add-web-line-tools, «Операции — функции над линией редактора»)
    function segmentOf(line: RouteLine) {
        const { points, route } = toSegment(line);
        return { points, route: settledRoute(route) };
    }

    // A list operation on the edited segment: the segment at index is replaced with parts, and remove is one more
    // segment of the same track (Join). The editor of the old segment is discarded (the store subscription: its array
    // is no longer in the track); edit is the index of the part to edit next, without it editing ends.
    function replaceEdited(parts: RouteLine[], options: { remove?: number; edit?: number } = {}) {
        const located = current && findSegment(current);
        if (!current || !located) {
            return;
        }
        const { track, index } = located;
        const built = parts.map(segmentOf);
        const segments: LatLng[][] = [];
        const routes: (SegmentRoute | null)[] = [];
        let editIndex = -1;
        track.segments.forEach((points, i) => {
            if (i === options.remove) {
                return;
            }
            if (i !== index) {
                segments.push(points);
                routes.push(track.routes?.[i] ?? null);
                return;
            }
            built.forEach((part, k) => {
                if (k === options.edit) {
                    editIndex = segments.length;
                }
                segments.push(part.points);
                routes.push(part.route);
            });
        });
        state().updateTrack(track.id, { segments, routes });
        if (editIndex >= 0) {
            start(track.id, editIndex);
        } else {
            stop();
        }
    }

    function line(): RouteLine | null {
        return current?.editor.line() ?? null;
    }

    function addSegment(trackId: string) {
        const track = state().tracks.find((item) => item.id === trackId);
        if (!track) {
            return;
        }
        if (!track.visible) {
            state().updateTrack(trackId, { visible: true });
        }
        const segments = [...track.segments, []];
        state().updateTrack(trackId, {
            segments,
            routes: segments.map((_, i) => track.routes?.[i] ?? null),
        });
        start(trackId, segments.length - 1, 'end');
    }

    return {
        start,
        stop,
        addSegment,
        // «New track»: a track and drawing at once (addTrackAndEdit of the old client); ruler: with distance ticks
        newTrack(name: string, fields: Partial<GeoData> = {}) {
            const [track] = state().addTracks(prepareImport([geoData(name || 'New track', fields)], true).tracks);
            addSegment(track.id);
        },
        isEditing: (trackId?: string) => current !== null && (trackId === undefined || current.trackId === trackId),
        drawing: () => drawing,
        startDrawing(end: End) {
            if (current) {
                drawing = end;
                publish();
            }
        },
        stopDrawing() {
            drawing = null;
            state().setRouteDrag(null);
            publish();
        },
        // a map click while drawing; alt: a straight leg without the router
        click(latlng: LatLng, alt = false) {
            if (drawing) {
                editor()?.addWaypoint(drawing, latlng, alt ? null : state().routingActivity);
            }
        },
        removeLastDrawn() {
            if (drawing) {
                editor()?.removeEndWaypoint(drawing);
            }
        },
        moveWaypoint: (index: number, latlng: LatLng) => editor()?.moveWaypoint(index, latlng),
        removeWaypoint: (index: number) => editor()?.removeWaypoint(index),

        // Line tools (spec route-editing; design add-web-line-tools, «Undo»): Cut, Join, deletion and extraction of a
        // segment are list operations without undo, Shortcut and Reverse are editor edits with undo.
        cut(place: LinePlace) {
            const edited = line();
            const parts = edited && cutLine(edited, place);
            if (parts) {
                replaceEdited(parts, { edit: 0 });
            }
        },
        reverse: () => editor()?.reverse(),
        deleteSegment: () => replaceEdited([]),
        newTrackFromSegment() {
            const edited = line();
            if (!edited) {
                return;
            }
            const { points, route } = segmentOf(edited);
            state().addTracks([geoData('New track', { segments: [points], routes: [route] })]);
        },
        startJoin(end: End) {
            if (current) {
                drawing = null;
                publish();
                state().setLineTool({ kind: 'join', end });
            }
        },
        // a click on the segment segment of the track trackId during the Join choice: that segment attaches with its
        // near end otherEnd
        join(trackId: string, segment: number, otherEnd: End) {
            const tool = state().lineTool;
            const located = current && findSegment(current);
            const edited = line();
            const other = state().tracks.find((track) => track.id === trackId);
            const points = other?.segments[segment];
            if (tool?.kind !== 'join' || !located || !edited || !other || !points) {
                return;
            }
            const sameTrack = other.id === located.track.id;
            if (sameTrack && segment === located.index) {
                return;
            }
            const joined = joinLines(edited, tool.end, fromSegment(points, other.routes?.[segment]), otherEnd);
            replaceEdited([joined], { edit: 0, remove: sameTrack ? segment : undefined });
        },
        startShortcut(from: LinePlace) {
            if (current) {
                drawing = null;
                publish();
                state().setLineTool({ kind: 'shortcut', from });
            }
        },
        // a click on place to in the Shortcut choice; false: nothing to remove, the choice goes on (getShortCutNodes)
        shortcut(to: LinePlace) {
            const tool = state().lineTool;
            if (tool?.kind !== 'shortcut' || !editor()?.shortcut(tool.from, to)) {
                return false;
            }
            state().setLineTool(null);
            return true;
        },
        cancelTool: () => state().setLineTool(null),
        // a menu at the screen point x, y; drawing ends (contextmenu of the old editor: stopDrawingLine)
        openMenu(x: number, y: number, target: MenuTarget) {
            if (target.kind !== 'point' && drawing) {
                drawing = null;
                state().setRouteDrag(null);
                publish();
            }
            state().setLineTool(null);
            state().setMapMenu({ x, y, target });
        },
        closeMenu: () => state().setMapMenu(null),
        insertWaypoint: (leg: number, latlng: LatLng) => editor()?.insertWaypoint(leg, latlng) ?? -1,
        undo: () => editor()?.undo(),
        redo: () => editor()?.redo(),
        pending: () => editor()?.pending() ?? 0,

        setActivity(id: string | null) {
            state().setRoutingActivity(id);
            saveActivity(storage, id);
            if (id) {
                router.warmUp();
            }
        },
        // on a page load with a selected activity, the engine warms up immediately (spec browser-routing-engine)
        warmUp() {
            if (state().routingActivity) {
                router.warmUp();
            }
        },
        // the mode and the engine state for the routing button (useSyncExternalStore)
        engine,
        engineStatus: () => router.status(),
        subscribeEngine: (listener: () => void) => router.subscribe(listener),
        async checkRouter() {
            const reachable = await router.isReachable();
            state().setRouterReachable(reachable);
        },
    };
}

export type RouteEditing = ReturnType<typeof createRouteEditing>;
