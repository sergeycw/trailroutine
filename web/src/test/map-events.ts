import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import { EDIT_LEGS, EDIT_WAYPOINTS } from '@/routing/edit-style';
import type { LatLng } from '@/tracks/model';

// Mouse and keyboard on a real MapLibre map for the browser tests of the editor: synthetic events on the canvas at
// map.project. So both MapLibre and the drag handlers on window get them (design add-web-route-editor).

export const P = (lat: number, lng: number) => ({ lat, lng });

export function features<T extends LineString | Point>(map: MaplibreMap, id: string) {
    const source = map.getSource(id);
    if (!source) {
        throw new Error(`нет источника ${id}`);
    }
    return (source.serialize() as { data: FeatureCollection<T> }).data.features;
}

export const waypoints = (map: MaplibreMap) =>
    features<Point>(map, EDIT_WAYPOINTS).map((f) => P(f.geometry.coordinates[1], f.geometry.coordinates[0]));
export const legs = (map: MaplibreMap) => features<LineString>(map, EDIT_LEGS);

// the map has drawn the last data of the sources: before that, queryRenderedFeatures does not see the new points
export function idle(map: MaplibreMap) {
    return new Promise<void>((resolve) => {
        map.once('idle', () => resolve());
        map.triggerRepaint();
    });
}

// mousemove comes after a mouse pointermove, as with a real mouse: on pointermove, the routing wait badge moves to the
// pointer (RoutingBadgeOnMap). The function does not send pointerdown: on the canvas it closes the track list
// (TopBar), and the tests use the open list after clicks on the map
export function fire(map: MaplibreMap, type: string, at: LatLng, init: MouseEventInit = {}) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    const point = map.project([at.lng, at.lat]);
    const event = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
        ...init,
    };
    if (type === 'mousemove') {
        map.getCanvas().dispatchEvent(new PointerEvent('pointermove', { ...event, pointerType: 'mouse' }));
    }
    map.getCanvas().dispatchEvent(new MouseEvent(type, event));
}

export async function click(map: MaplibreMap, at: LatLng, init: MouseEventInit = {}) {
    await idle(map);
    fire(map, 'mousemove', at, init);
    fire(map, 'mousedown', at, init);
    fire(map, 'mouseup', at, init);
    fire(map, 'click', at, init);
    await idle(map);
}

export async function drag(map: MaplibreMap, from: LatLng, to: LatLng) {
    await idle(map);
    fire(map, 'mousemove', from);
    fire(map, 'mousedown', from);
    const steps = 4;
    for (let i = 1; i <= steps; i++) {
        fire(
            map,
            'mousemove',
            P(from.lat + ((to.lat - from.lat) * i) / steps, from.lng + ((to.lng - from.lng) * i) / steps),
        );
    }
    fire(map, 'mouseup', to);
    fire(map, 'click', to);
    await idle(map);
}

export async function dblclick(map: MaplibreMap, at: LatLng) {
    await click(map, at);
    await click(map, at);
    fire(map, 'dblclick', at);
    await idle(map);
}

export function key(init: KeyboardEventInit, target: EventTarget = document.body) {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

export const pressEscape = () => key({ key: 'Escape', code: 'Escape' });

// the coordinates of synthetic mouse events are whole pixels: at this zoom, a pixel is ≈ 0.00004°
export const near = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;

export async function newTrack(map: MaplibreMap, points: LatLng[]) {
    await page.getByRole('button', { name: 'New track' }).first().click();
    for (const point of points) {
        await click(map, point);
    }
}

export function editPanel() {
    return page.getByTestId('edit-panel');
}

// Right click: MapLibre sends the map event contextmenu only after mousedown (BlockableMapEventHandler in
// ui/handler/map_event.ts: without mousedown it ignores contextmenu, and on Mac it delays contextmenu until mouseup)
export async function rightClick(map: MaplibreMap, at: LatLng) {
    await idle(map);
    fire(map, 'mousemove', at);
    fire(map, 'mousedown', at, { button: 2, buttons: 2 });
    fire(map, 'contextmenu', at, { button: 2, buttons: 2 });
    fire(map, 'mouseup', at, { button: 2 });
    await idle(map);
}

// Finger touch: a synthetic TouchEvent on the canvas at map.project, as the mouse above
export function touch(map: MaplibreMap, type: 'touchstart' | 'touchmove' | 'touchend', at: LatLng) {
    const rect = map.getCanvasContainer().getBoundingClientRect();
    const point = map.project([at.lng, at.lat]);
    const finger = new Touch({
        identifier: 1,
        target: map.getCanvas(),
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
    });
    const touches = type === 'touchend' ? [] : [finger];
    map.getCanvas().dispatchEvent(
        new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            targetTouches: touches,
            changedTouches: [finger],
        }),
    );
}

// a long press without a move: longer than LONG_PRESS_MS of the editor (500 ms)
export async function longPress(map: MaplibreMap, at: LatLng) {
    await idle(map);
    touch(map, 'touchstart', at);
    await new Promise((resolve) => setTimeout(resolve, 700));
    touch(map, 'touchend', at);
    await idle(map);
}

export async function tap(map: MaplibreMap, at: LatLng) {
    await idle(map);
    touch(map, 'touchstart', at);
    touch(map, 'touchend', at);
    await idle(map);
}

export function mapMenu() {
    return page.getByTestId('map-menu');
}

// the items of the open map menu in their order
export async function menuItems(): Promise<string[]> {
    await expect.element(mapMenu()).toBeVisible();
    return mapMenu()
        .getByRole('menuitem')
        .elements()
        .map((element) => element.textContent ?? '');
}

export async function chooseFromMenu(item: string) {
    await mapMenu().getByRole('menuitem', { name: item, exact: true }).click();
}
