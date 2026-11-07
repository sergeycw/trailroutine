import { useMap } from '@vis.gl/react-maplibre';
import type { Point } from 'geojson';
import type { GeoJSONSource, Map as MaplibreMap, MapMouseEvent, MapTouchEvent, PointLike } from 'maplibre-gl';
import { useEffect } from 'react';
import { useAppStoreApi } from '@/state/context';
import type { AppStore, MenuTarget, RouteEditState } from '@/state/store';
import { useStreetView } from '@/streetview/context';
import type { StreetView } from '@/streetview/controller';
import type { TrackActions } from '@/tracks/actions';
import { useTrackActions } from '@/tracks/actions-context';
import { distance } from '@/tracks/geometry';
import { type LatLng, trackColor, type Waypoint } from '@/tracks/model';
import { TRACK_LINES, TRACK_POINTS, TRACK_UNROUTED } from '@/tracks/style';
import { EDIT_PREVIEW, EDIT_WAYPOINTS, previewData, toolPreviewData, waypointRole } from './edit-style';
import type { RouteEditing } from './editing';
import { useRouteEditing } from './editing-context';
import type { End } from './editor';
import { legPath } from './line';
import { type LinePlace, placePoint, shortcutRemoved, toolOrigin } from './line-tools';

// Map events for the editor (design add-web-route-editor, «События карты»). The component is inside <Map>: the MapLibre
// and document handlers are attached one time, and the current state is read from the store at the time of the event.
//
// - click: on a waypoint (an end waypoint starts drawing from its end, the last placed waypoint ends drawing); while
//   drawing, a new point (Alt: a straight leg); without drawing, a click on a track line starts editing, a click past
//   the line ends editing;
// - a press on a waypoint starts a drag; a press on the line (not while drawing) inserts a point and drags it;
//   preventDefault on mousedown/touchstart turns off MapLibre map panning for this gesture (ui/handler/map_event.ts);
// - a double click on a waypoint removes it, preventDefault stops the zoom;
// - keys on keydown: on macOS, while Cmd is down, other keys send no keyup (docs/architecture/route-editor.md,
//   «History»);
// - the drag preview and the rubber band: setData of the preview source past the style (edit-style.ts);
// - line tools and track points (design add-web-line-tools): a right click and a long press open the menu, a click on
//   a track point opens the point menu, the Join and Shortcut choice and the point modes take the map clicks.

// hit tolerance for a point and a line, px: the waypoint circle is radius 6 + outline 2; on the line for an insertion,
// 7 px to both sides of the thin editor line
const HIT_RADIUS = 9;
const LINE_HIT = 7;
// after a touch, the browser sends compatibility mousedown/mouseup/click: a mousedown at this time is an echo of the
// tap, not a gesture
const TOUCH_ECHO_MS = 800;
// a click immediately after a drag or an insertion is the end of the same gesture
const CLICK_AFTER_GESTURE_MS = 400;
// a long finger press opens the menu; a move of more than DRAG_THRESHOLD px before it starts a drag (design
// add-web-line-tools, «Меню на карте»: contextmenu on a phone is not reliable, iOS Safari does not send it)
const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 3;
const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

export type EditorKey = 'undo' | 'redo' | 'backspace' | 'escape' | 'enter';

// Editor hotkeys by event.code: they do not depend on the keyboard layout. In input fields, menus and dialogs the
// editor does not touch keys; Enter works only on the map or without focus: on a focused button, Enter presses it.
export function editorKey(event: KeyboardEvent, map?: HTMLElement): EditorKey | null {
    if (event.defaultPrevented) {
        return null;
    }
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (
        target &&
        (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
            target.closest('[role="menu"], [role="dialog"], [role="listbox"]'))
    ) {
        return null;
    }
    const command = event.ctrlKey || event.metaKey;
    if (command && event.code === 'KeyZ') {
        return event.shiftKey ? 'redo' : 'undo';
    }
    if (event.ctrlKey && event.code === 'KeyY') {
        return 'redo';
    }
    if (command || event.altKey) {
        return null;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
        return 'backspace';
    }
    if (event.key === 'Escape') {
        return 'escape';
    }
    if (event.key === 'Enter' && (!target || target === document.body || map?.contains(target))) {
        return 'enter';
    }
    return null;
}

type ScreenPoint = { x: number; y: number };

function sqDistToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dot = dx * dx + dy * dy;
    const t = dot > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / dot)) : 0;
    return (p.x - a.x - dx * t) ** 2 + (p.y - a.y - dy * t) ** 2;
}

// A hit on a waypoint and a leg for clicks and presses is calculated from the line in the store, not from the drawn
// frame: the source data gets to the frame through the MapLibre worker, and on a fast second click
// queryRenderedFeatures does not see a new point yet.
function waypointAt(map: MaplibreMap, edit: RouteEditState, point: ScreenPoint): number | null {
    let best: number | null = null;
    let bestDistance = HIT_RADIUS ** 2;
    edit.line.waypoints.forEach((waypoint, index) => {
        const projected = map.project([waypoint.lng, waypoint.lat]);
        const d = (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
        if (d <= bestDistance) {
            bestDistance = d;
            best = index;
        }
    });
    return best;
}

function legAt(map: MaplibreMap, edit: RouteEditState, point: ScreenPoint): number | null {
    let best: number | null = null;
    let bestDistance = LINE_HIT ** 2;
    edit.line.legs.forEach((leg, index) => {
        if (leg.state === 'pending') {
            return;
        }
        const path = legPath(edit.line, index).map((p) => map.project([p.lng, p.lat]));
        for (let k = 0; k < path.length - 1; k++) {
            const d = sqDistToSegment(point, path[k], path[k + 1]);
            if (d <= bestDistance) {
                bestDistance = d;
                best = index;
            }
        }
    });
    return best;
}

// The hover cursor uses the drawn frame: it is cheap (a spatial index), and a lag of one frame is not visible
function waypointUnderCursor(map: MaplibreMap, point: ScreenPoint): boolean {
    const box: [PointLike, PointLike] = [
        [point.x - HIT_RADIUS, point.y - HIT_RADIUS],
        [point.x + HIT_RADIUS, point.y + HIT_RADIUS],
    ];
    return map.queryRenderedFeatures(box, { layers: [EDIT_WAYPOINTS] }).length > 0;
}

function hitTrack(map: MaplibreMap, point: ScreenPoint): { trackId: string; segment: number } | null {
    const box: [PointLike, PointLike] = [
        [point.x - 5, point.y - 5],
        [point.x + 5, point.y + 5],
    ];
    const [feature] = map.queryRenderedFeatures(box, { layers: [TRACK_LINES, TRACK_UNROUTED] });
    return feature ? { trackId: feature.properties.id as string, segment: feature.properties.segment as number } : null;
}

// Track point under the cursor: by the drawn frame, as track lines; the point index is a feature property
// (tracks/style.ts)
function trackPointAt(
    map: MaplibreMap,
    store: AppStore,
    point: ScreenPoint,
): { trackId: string; point: Waypoint } | null {
    const box: [PointLike, PointLike] = [
        [point.x - HIT_RADIUS, point.y - HIT_RADIUS],
        [point.x + HIT_RADIUS, point.y + HIT_RADIUS],
    ];
    const [feature] = map.queryRenderedFeatures(box, { layers: [TRACK_POINTS] });
    if (!feature) {
        return null;
    }
    const trackId = feature.properties.id as string;
    const found = store.getState().tracks.find((track) => track.id === trackId)?.points[
        feature.properties.index as number
    ];
    // the frame can be behind the store (a point was just removed, indexes shifted): the index must have the same point
    const [lng, lat] = (feature.geometry as Point).coordinates;
    const same =
        found && found.name === feature.properties.name && Math.abs(found.lat - lat) + Math.abs(found.lng - lng) < 1e-5;
    return same ? { trackId, point: found } : null;
}

// The point in the world copy that is nearer to the reference point (wrapLatLngToTarget of the old client): MapLibre
// draws world copies, and otherwise a click on a neighbor copy would make the line jump across the whole world
export function nearTo(latlng: LatLng, reference: LatLng | undefined): LatLng {
    if (!reference) {
        return latlng;
    }
    return { lat: latlng.lat, lng: latlng.lng + 360 * Math.round((reference.lng - latlng.lng) / 360) };
}

function lngLat(event: MapMouseEvent | MapTouchEvent): LatLng {
    return { lat: event.lngLat.lat, lng: event.lngLat.lng };
}

function editColor(store: AppStore): string {
    const { routeEdit, tracks } = store.getState();
    return trackColor(tracks.find((track) => track.id === routeEdit?.trackId)?.color);
}

// panorama search radius on a click: 24 screen px in meters (onMapClick of the panorama control of the old client)
const PANORAMA_SEARCH_PX = 24;

function bind(
    map: MaplibreMap,
    store: AppStore,
    editing: RouteEditing,
    actions: TrackActions,
    streetView: StreetView,
): () => void {
    const state = () => store.getState();
    let suppressClickUntil = 0;
    let lastTouch = Number.NEGATIVE_INFINITY;
    let touching = false;
    let dragging = false;
    // the editor set its own long press for this touch (a finger on a waypoint or on a leg): the MapLibre contextmenu
    // for the same gesture is not necessary, both timers are 500 ms. It resets at the end of the touch.
    let ownLongPress = false;

    // the place on the edited line under the screen point: a waypoint or a leg
    function placeAt(edit: RouteEditState, point: ScreenPoint, latlng: LatLng): LinePlace | null {
        const index = waypointAt(map, edit, point);
        if (index !== null) {
            return { waypoint: index };
        }
        const leg = legAt(map, edit, point);
        return leg === null ? null : { leg, latlng: nearTo(latlng, edit.line.waypoints[leg]) };
    }

    // What is under the menu: a waypoint or a leg of the edited line, a track point, a track line (its editing starts).
    // null: no menu.
    function menuTarget(point: ScreenPoint, latlng: LatLng): MenuTarget | null {
        let edit = state().routeEdit;
        const place = edit && placeAt(edit, point, latlng);
        if (place) {
            return 'waypoint' in place ? { kind: 'waypoint', index: place.waypoint } : { kind: 'line', place };
        }
        const trackPoint = trackPointAt(map, store, point);
        if (trackPoint) {
            return { kind: 'point', ...trackPoint };
        }
        const track = hitTrack(map, point);
        if (!track) {
            return null;
        }
        editing.start(track.trackId, track.segment);
        edit = state().routeEdit;
        const leg = edit && legAt(map, edit, point);
        return edit && leg !== null && leg !== undefined
            ? { kind: 'line', place: { leg, latlng: nearTo(latlng, edit.line.waypoints[leg]) } }
            : null;
    }

    function openMenu(point: ScreenPoint, latlng: LatLng, client: ScreenPoint): boolean {
        const target = menuTarget(point, latlng);
        if (!target) {
            return false;
        }
        setPreview(null);
        editing.openMenu(client.x, client.y, target);
        return true;
    }

    function setPreview(data: ReturnType<typeof previewData> | null) {
        (map.getSource(EDIT_PREVIEW) as GeoJSONSource | undefined)?.setData(data ?? previewData([], ''));
    }

    function updateCursor(overWaypoint: boolean) {
        const edit = state().routeEdit;
        let cursor = '';
        if (overWaypoint || dragging) {
            cursor = 'move';
        } else if (edit?.drawing || state().lineTool || state().pointTool) {
            cursor = 'crosshair';
        }
        map.getCanvas().style.cursor = cursor;
    }

    function rubberBand(cursor: LatLng | null) {
        if (dragging) {
            return;
        }
        const edit = state().routeEdit;
        const anchor = edit?.drawing === 'end' ? edit.line.waypoints.at(-1) : edit?.line.waypoints[0];
        if (!edit?.drawing || !cursor || !anchor) {
            setPreview(null);
            return;
        }
        setPreview(previewData([[anchor, nearTo(cursor, anchor)]], editColor(store)));
    }

    function startDrag(index: number, inserted: boolean, clientStart: ScreenPoint, touch: boolean) {
        const edit = state().routeEdit;
        const origin = edit?.line.waypoints[index];
        if (!edit || !origin) {
            return;
        }
        dragging = true;
        // the line at the start of the gesture: finish compares with it (the function declaration is hoisted, and the
        // narrowing of edit does not reach it)
        const { trackId, segment, revision } = edit;
        const { waypoints } = edit.line;
        const role = waypointRole(index, waypoints.length);
        const color = editColor(store);
        const neighbours = [waypoints[index - 1], waypoints[index + 1]].filter((p): p is LatLng => Boolean(p));
        let latlng = origin;
        let moved = false;
        const canvas = map.getCanvasContainer();
        // a finger on a waypoint without a move opens the point menu, not a drag
        if (touch && !inserted) {
            ownLongPress = true;
        }
        const longPress =
            touch && !inserted
                ? window.setTimeout(() => {
                      if (moved) {
                          return;
                      }
                      finish();
                      menuAfterLongPress(() =>
                          editing.openMenu(clientStart.x, clientStart.y, { kind: 'waypoint', index }),
                      );
                  }, LONG_PRESS_MS)
                : undefined;

        function move(clientX: number, clientY: number) {
            if (!moved && Math.hypot(clientX - clientStart.x, clientY - clientStart.y) < DRAG_THRESHOLD) {
                return;
            }
            if (!moved) {
                // the point and its legs leave the line sources: the preview draws them
                state().setRouteDrag(index);
            }
            moved = true;
            const rect = canvas.getBoundingClientRect();
            const point = map.unproject([clientX - rect.left, clientY - rect.top]);
            latlng = nearTo({ lat: point.lat, lng: point.lng }, origin);
            setPreview(
                previewData(
                    neighbours.map((p) => [p, latlng]),
                    color,
                    { latlng, role },
                ),
            );
        }

        const onMouseMove = (event: MouseEvent) => move(event.clientX, event.clientY);
        const onTouchMove = (event: TouchEvent) => {
            const t = event.touches[0];
            if (t) {
                event.preventDefault();
                move(t.clientX, t.clientY);
            }
        };
        function finish() {
            window.clearTimeout(longPress);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', finish);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', finish);
            window.removeEventListener('touchcancel', finish);
            dragging = false;
            setPreview(null);
            state().setRouteDrag(null);
            // the line was not edited during the gesture: the editor keys do not let a keyboard undo through during a
            // drag, so this is a check just in case. The check uses the edit number, not the point: a router response
            // can move this same point to a turn (a spur at a turn, spur.ts), and then the drag would be lost
            const now = state().routeEdit;
            if (moved && now?.trackId === trackId && now.segment === segment && now.revision === revision) {
                editing.moveWaypoint(index, latlng);
            }
            if (moved || inserted) {
                suppressClickUntil = performance.now() + CLICK_AFTER_GESTURE_MS;
            }
        }
        if (touch) {
            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('touchend', finish);
            window.addEventListener('touchcancel', finish);
        } else {
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', finish);
        }
    }

    // The menu after a long press. A finger lift is the end of the same gesture: preventDefault on touchend stops the
    // compatibility mousedown/click that the browser otherwise sends after a touch. The Base UI menu takes that
    // mousedown as a press outside and closes (useDismiss, outsidePressEvent 'sloppy'), and the map click would place a
    // point.
    function menuAfterLongPress(open: () => void) {
        setPreview(null);
        open();
        // the gesture can end with touchcancel: then the touchend listener is removed, else it would stop the next tap
        const onEnd = (event: TouchEvent) => {
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onEnd);
            if (event.type === 'touchend') {
                event.preventDefault();
                suppressClickUntil = performance.now() + CLICK_AFTER_GESTURE_MS;
            }
        };
        window.addEventListener('touchend', onEnd, { passive: false });
        window.addEventListener('touchcancel', onEnd);
    }

    // A touch on a leg: the point is not inserted immediately, but when the finger moves (insertion and drag) or lifts
    // before LONG_PRESS_MS (a tap is an insertion, as with a mouse); a long press without a move opens the line menu
    // (design add-web-line-tools)
    function touchOnLeg(leg: number, latlng: LatLng, clientStart: ScreenPoint) {
        let done = false;
        ownLongPress = true;
        const cleanup = () => {
            done = true;
            window.clearTimeout(timer);
            window.removeEventListener('touchmove', onMove);
            window.removeEventListener('touchend', onEnd);
            window.removeEventListener('touchcancel', onCancel);
        };
        const insert = () => {
            cleanup();
            return editing.insertWaypoint(leg, latlng);
        };
        const onMove = (event: TouchEvent) => {
            const t = event.touches[0];
            if (!t || Math.hypot(t.clientX - clientStart.x, t.clientY - clientStart.y) < DRAG_THRESHOLD) {
                return;
            }
            event.preventDefault();
            const inserted = insert();
            if (inserted >= 0) {
                startDrag(inserted, true, clientStart, true);
            }
        };
        const onEnd = () => {
            if (insert() >= 0) {
                suppressClickUntil = performance.now() + CLICK_AFTER_GESTURE_MS;
            }
        };
        const onCancel = () => cleanup();
        const timer = window.setTimeout(() => {
            if (done) {
                return;
            }
            cleanup();
            menuAfterLongPress(() =>
                editing.openMenu(clientStart.x, clientStart.y, { kind: 'line', place: { leg, latlng } }),
            );
        }, LONG_PRESS_MS);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onCancel);
    }

    function onDown(event: MapMouseEvent | MapTouchEvent, client: ScreenPoint, touch: boolean) {
        const edit = state().routeEdit;
        // the map choice and the point modes take the clicks, a press only moves the map
        if (!edit || dragging || state().lineTool || state().pointTool || state().mapMenu) {
            return;
        }
        const index = waypointAt(map, edit, event.point);
        if (index !== null) {
            event.preventDefault();
            startDrag(index, false, client, touch);
            return;
        }
        // a track point on the line: a press on it does not insert a line point, else the point menu is not reachable
        if (edit.drawing || trackPointAt(map, store, event.point)) {
            return;
        }
        const leg = legAt(map, edit, event.point);
        if (leg === null) {
            return;
        }
        event.preventDefault();
        const latlng = nearTo(lngLat(event), edit.line.waypoints[leg]);
        if (touch) {
            touchOnLeg(leg, latlng, client);
            return;
        }
        const inserted = editing.insertWaypoint(leg, latlng);
        if (inserted >= 0) {
            startDrag(inserted, true, client, touch);
        }
    }

    const onMouseDown = (event: MapMouseEvent) => {
        // Ctrl+click on macOS is a right click: mousedown comes with button 0, and without this check it would insert a
        // point and start a drag, and contextmenu would be dropped
        const macContextClick = event.originalEvent.ctrlKey && MAC;
        if (event.originalEvent.button !== 0 || macContextClick || performance.now() - lastTouch < TOUCH_ECHO_MS) {
            return;
        }
        onDown(event, { x: event.originalEvent.clientX, y: event.originalEvent.clientY }, false);
    };
    const onTouchStart = (event: MapTouchEvent) => {
        lastTouch = performance.now();
        touching = true;
        ownLongPress = false;
        const t = event.originalEvent.touches[0];
        if (event.originalEvent.touches.length === 1 && t) {
            onDown(event, { x: t.clientX, y: t.clientY }, true);
        }
    };

    const onTouchEnd = () => {
        lastTouch = performance.now();
        touching = false;
        ownLongPress = false;
    };

    // Right click (MapLibre contextmenu): the menu of a waypoint, a line or a track point; preventDefault on the
    // browser event stops its own menu. During a touch, the map contextmenu is the long press of MapLibre itself
    // (MapLibre stops the native browser event on a touch, ui/handler/map_event.ts); right after a touch, an echo.
    const onContextMenu = (event: MapMouseEvent) => {
        const client = { x: event.originalEvent.clientX, y: event.originalEvent.clientY };
        if (touching) {
            // a long press that MapLibre counted itself (a finger on a line out of editing, on a leg during drawing):
            // the editor has no own timer for this gesture
            event.originalEvent.preventDefault();
            if (!ownLongPress && !dragging && !state().pointTool && !state().lineTool) {
                menuAfterLongPress(() => openMenu(event.point, lngLat(event), client));
            }
            return;
        }
        if (performance.now() - lastTouch < TOUCH_ECHO_MS || dragging) {
            event.originalEvent.preventDefault();
            return;
        }
        if (state().pointTool) {
            return;
        }
        if (openMenu(event.point, lngLat(event), client)) {
            event.originalEvent.preventDefault();
        }
    };

    // A click in the track point mode: place a point or move it (createNewPoint, movePoint of the old client)
    function pointToolClick(latlng: LatLng): boolean {
        const tool = state().pointTool;
        if (!tool) {
            return false;
        }
        if (tool.kind === 'add') {
            actions.addPoint(tool.trackId, latlng);
        } else {
            actions.movePoint(tool.trackId, tool.point, latlng);
        }
        return true;
    }

    // Join: the segment end nearer to the click by distance (isPointCloserToStart of the old client)
    function nearerEnd(trackId: string, segment: number, latlng: LatLng): { end: End; point: LatLng } | null {
        const points = state().tracks.find((track) => track.id === trackId)?.segments[segment];
        const first = points?.[0];
        const last = points?.at(-1);
        if (!first || !last) {
            return null;
        }
        return distance(latlng, first) < distance(latlng, last)
            ? { end: 'start', point: first }
            : { end: 'end', point: last };
    }

    // A click in the Join or Shortcut choice; a click past the line cancels (map.on('click', hideLineCursor) of the old
    // client)
    function lineToolClick(edit: RouteEditState, point: ScreenPoint, latlng: LatLng): boolean {
        const tool = state().lineTool;
        if (!tool) {
            return false;
        }
        if (tool.kind === 'join') {
            const track = hitTrack(map, point);
            const end = track && nearerEnd(track.trackId, track.segment, latlng);
            if (track && end) {
                editing.join(track.trackId, track.segment, end.end);
            } else {
                editing.cancelTool();
            }
        } else {
            const place = placeAt(edit, point, latlng);
            // a place after which there is nothing to remove: nothing happens, the choice continues
            if (!place) {
                editing.cancelTool();
            } else {
                editing.shortcut(place);
            }
        }
        setPreview(null);
        return true;
    }

    const onClick = (event: MapMouseEvent) => {
        if (performance.now() < suppressClickUntil || state().mapMenu) {
            return;
        }
        // drawing, point placing and Join/Shortcut choice clicks belong to the editor (design add-web-search-panoramas)
        const busy = Boolean(state().routeEdit?.drawing || state().pointTool || state().lineTool);
        // a map click past the search placemark removes it (onMapClick of the old placemark), but not a busy click: the
        // user draws a line to the placemark (design add-web-search-panoramas, «Метка»); a click on the placemark
        // itself does not come here
        if (state().placemark && !busy) {
            state().setPlacemark(null);
        }
        // Street View mode: a free click searches for a panorama, and the editor works as usual, as the two independent
        // click handlers of the old client do («Street View: режим, клик, окно»)
        // a click on a track point (menu) or on a waypoint belongs to them
        const onPoint =
            trackPointAt(map, store, event.point) !== null ||
            (state().routeEdit !== null && waypointAt(map, state().routeEdit as RouteEditState, event.point) !== null);
        if (state().streetView.enabled && !busy && !onPoint) {
            const at = lngLat(event);
            const edge = map.unproject([event.point.x + PANORAMA_SEARCH_PX, event.point.y]);
            void streetView.searchAt(at, distance(at, { lat: edge.lat, lng: edge.lng }));
        }
        if (pointToolClick(lngLat(event))) {
            return;
        }
        const edit = state().routeEdit;
        if (edit && lineToolClick(edit, event.point, lngLat(event))) {
            return;
        }
        const trackPoint = edit?.drawing ? null : trackPointAt(map, store, event.point);
        if (edit) {
            const index = waypointAt(map, edit, event.point);
            const last = edit.line.waypoints.length - 1;
            if (index !== null) {
                if (edit.drawing) {
                    // a click on the last placed point ends drawing
                    if ((edit.drawing === 'end' && index === last) || (edit.drawing === 'start' && index === 0)) {
                        editing.stopDrawing();
                        setPreview(null);
                    }
                } else if (index === last || index === 0) {
                    editing.startDrawing(index === last ? 'end' : 'start');
                }
                return;
            }
            if (trackPoint) {
                openPointMenu(trackPoint, event);
                return;
            }
            if (edit.drawing) {
                const anchor = edit.drawing === 'end' ? edit.line.waypoints.at(-1) : edit.line.waypoints[0];
                editing.click(nearTo(lngLat(event), anchor), event.originalEvent.altKey);
                // the rubber band now goes from the new point, not from the previous one
                rubberBand(lngLat(event));
                return;
            }
            if (legAt(map, edit, event.point) !== null) {
                return;
            }
        }
        if (trackPoint) {
            openPointMenu(trackPoint, event);
            return;
        }
        const track = hitTrack(map, event.point);
        if (track) {
            editing.start(track.trackId, track.segment);
            return;
        }
        if (edit) {
            editing.stop();
        }
    };

    // the track point menu opens on a click (onMarkerClick of the old client: both left and right)
    function openPointMenu(target: { trackId: string; point: Waypoint }, event: MapMouseEvent) {
        editing.openMenu(event.originalEvent.clientX, event.originalEvent.clientY, { kind: 'point', ...target });
    }

    const onDblClick = (event: MapMouseEvent) => {
        const edit = state().routeEdit;
        if (!edit) {
            return;
        }
        const index = waypointAt(map, edit, event.point);
        if (index !== null) {
            event.preventDefault();
            editing.removeWaypoint(index);
        }
    };

    const onMouseMove = (event: MapMouseEvent) => {
        // during a drag, the gesture itself controls the cursor and the preview
        if (dragging) {
            return;
        }
        const edit = state().routeEdit;
        if (edit && state().lineTool) {
            toolPreview(edit, event.point, lngLat(event));
            return;
        }
        updateCursor(edit !== null && !edit.drawing && waypointUnderCursor(map, event.point));
        rubberBand(lngLat(event));
    };

    // Preview of the Join and Shortcut choice: a line from the start to the cursor (over a valid place it is green and
    // snaps to the place), for Shortcut also the part to remove
    function toolPreview(edit: RouteEditState, point: ScreenPoint, cursor: LatLng) {
        const tool = state().lineTool;
        if (!tool) {
            return;
        }
        if (tool.kind === 'join') {
            const anchor = toolOrigin(edit.line, tool);
            const track = hitTrack(map, point);
            const end = track && nearerEnd(track.trackId, track.segment, cursor);
            if (anchor) {
                setPreview(toolPreviewData([anchor, end ? end.point : nearTo(cursor, anchor)], Boolean(end)));
            }
            return;
        }
        const from = toolOrigin(edit.line, tool);
        if (!from) {
            return;
        }
        const to = placeAt(edit, point, cursor);
        const removed = to && shortcutRemoved(edit.line, tool.from, to);
        const end = to && removed ? placePoint(edit.line, to) : null;
        setPreview(toolPreviewData([from, end ?? nearTo(cursor, from)], Boolean(removed), removed));
    }

    const onMouseOut = () => rubberBand(null);

    const onKeyDown = (event: KeyboardEvent) => {
        // an open map menu takes the keys (Escape closes it, not editing)
        if (state().mapMenu) {
            return;
        }
        if (toolKey(event)) {
            event.preventDefault();
            return;
        }
        const edit = state().routeEdit;
        // during a drag the keyboard does not change the line: the index of the dragged point must stay correct
        const key = edit && !dragging ? editorKey(event, map.getContainer()) : null;
        if (!key) {
            return;
        }
        if (key === 'undo') {
            editing.undo();
        } else if (key === 'redo') {
            editing.redo();
        } else if (key === 'backspace') {
            if (!edit?.drawing) {
                return;
            }
            editing.removeLastDrawn();
        } else if (edit?.drawing) {
            editing.stopDrawing();
            setPreview(null);
        } else {
            editing.stop();
        }
        event.preventDefault();
    };

    // Escape (and Enter during the map choice) leaves the point mode and the Join/Shortcut choice; the other editor
    // keys do not work during the choice: a line edit would shift the index of the point that the choice starts from
    function toolKey(event: KeyboardEvent): boolean {
        const { lineTool, pointTool, routeEdit } = state();
        if (!lineTool && !pointTool) {
            return false;
        }
        const key = editorKey(event, map.getContainer());
        if (pointTool && key === 'escape') {
            actions.stopPointTool();
            return true;
        }
        if (lineTool && routeEdit && key) {
            if (key === 'escape' || key === 'enter') {
                editing.cancelTool();
                setPreview(null);
            }
            return true;
        }
        return false;
    }

    // the cursor follows the state: drawing, tools. Route waits do not change the cursor: the badge at the pointer
    // shows them (RoutingBadgeOnMap, design route-thread-loader)
    const unsubscribe = store.subscribe((next, prev) => {
        if (next.lineTool !== prev.lineTool && !next.lineTool) {
            setPreview(null);
        }
        if (next.routeEdit !== prev.routeEdit || next.lineTool !== prev.lineTool || next.pointTool !== prev.pointTool) {
            updateCursor(false);
        }
    });

    map.on('mousedown', onMouseDown);
    map.on('touchstart', onTouchStart);
    map.on('touchend', onTouchEnd);
    map.on('touchcancel', onTouchEnd);
    map.on('contextmenu', onContextMenu);
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    document.addEventListener('keydown', onKeyDown);
    return () => {
        unsubscribe();
        map.off('mousedown', onMouseDown);
        map.off('touchstart', onTouchStart);
        map.off('touchend', onTouchEnd);
        map.off('touchcancel', onTouchEnd);
        map.off('contextmenu', onContextMenu);
        map.off('click', onClick);
        map.off('dblclick', onDblClick);
        map.off('mousemove', onMouseMove);
        map.off('mouseout', onMouseOut);
        document.removeEventListener('keydown', onKeyDown);
    };
}

export function MapEditor() {
    const { current } = useMap();
    const store = useAppStoreApi();
    const editing = useRouteEditing();
    const actions = useTrackActions();
    const streetView = useStreetView();
    useEffect(() => {
        const map = current?.getMap();
        return map ? bind(map, store, editing, actions, streetView) : undefined;
    }, [current, store, editing, actions, streetView]);
    return null;
}
