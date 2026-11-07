import { useEffect, useMemo } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useElevationProfile } from '@/elevation/context';
import { useAppStore } from '@/state/context';
import type { MapMenu as MapMenuState, RouteEditState } from '@/state/store';
import { useTrackActions } from '@/tracks/actions-context';
import { useRouteEditing } from './editing-context';
import type { LinePlace } from './line-tools';

// The map menu (design add-web-line-tools, «Меню на карте»): one per app, it opens at the screen point where the user
// right-clicked, long-pressed with a finger or clicked a track point. The items and texts are onNodeRightClickShowMenu,
// onSegmentRightClickShowMenu and onMarkerClick of the old client; «Delete point» removes a waypoint on a phone, where
// a double tap zooms the map.

type Item = { text: string; run: () => void } | '-';

function useItems(menu: MapMenuState, edit: RouteEditState | null): { label?: string; items: Item[] } {
    const editing = useRouteEditing();
    const actions = useTrackActions();
    const profile = useElevationProfile();
    const { target } = menu;
    if (target.kind === 'point') {
        const { trackId, point } = target;
        return {
            label: point.name || '(no name)',
            items: [
                { text: 'Rename', run: () => actions.startRenamePoint(trackId, point) },
                { text: 'Move', run: () => actions.startMovePoint(trackId, point) },
                { text: 'Copy coordinates', run: () => actions.copyPointCoordinates(point) },
                { text: 'Delete', run: () => actions.removePoint(trackId, point) },
            ],
        };
    }
    if (!edit) {
        return { items: [] };
    }
    const segment: Item[] = [
        { text: 'Delete segment', run: editing.deleteSegment },
        { text: 'New track from segment', run: editing.newTrackFromSegment },
        // the segment profile; editing continues (design add-web-elevation-profile, «Профиль следует за треком»)
        { text: 'Show elevation profile for segment', run: () => profile.open(edit.trackId, edit.segment) },
    ];
    if (target.kind === 'line') {
        const place: LinePlace = target.place;
        return {
            items: [
                { text: 'Cut', run: () => editing.cut(place) },
                { text: 'Reverse', run: editing.reverse },
                { text: 'Shortcut', run: () => editing.startShortcut(place) },
                '-',
                ...segment,
            ],
        };
    }
    const { index } = target;
    const last = edit.line.waypoints.length - 1;
    const items: Item[] = [];
    if (index > 0 && index < last) {
        items.push({ text: 'Cut', run: () => editing.cut({ waypoint: index }) });
    }
    if (index === 0 || index === last) {
        items.push({ text: 'Join', run: () => editing.startJoin(index === 0 ? 'start' : 'end') });
    }
    items.push(
        { text: 'Reverse', run: editing.reverse },
        { text: 'Shortcut', run: () => editing.startShortcut({ waypoint: index }) },
        { text: 'Delete point', run: () => editing.removeWaypoint(index) },
        '-',
        ...segment,
    );
    return { items };
}

function Menu({ menu }: { menu: MapMenuState }) {
    const editing = useRouteEditing();
    const edit = useAppStore((state) => state.routeEdit);
    const { label, items } = useItems(menu, edit);
    // a virtual element at the click point: Base UI Menu.Positioner takes it as an anchor (useAnchorPositioning.d.ts)
    const anchor = useMemo(
        () => ({ getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }) }),
        [menu.x, menu.y],
    );
    // a menu without items (the target is gone) closes, otherwise an invisible menu would block the clicks on the map
    const empty = items.length === 0;
    useEffect(() => {
        if (empty) {
            editing.closeMenu();
        }
    }, [empty, editing]);
    if (empty) {
        return null;
    }
    return (
        <DropdownMenu open onOpenChange={(open) => !open && editing.closeMenu()}>
            <DropdownMenuContent anchor={anchor} className="w-auto" data-testid="map-menu">
                {label !== undefined && (
                    <>
                        <DropdownMenuGroup>
                            <DropdownMenuLabel className="max-w-56 truncate">{label}</DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                    </>
                )}
                {items.map((item, i) =>
                    item === '-' ? (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a separator without an id, items do not move
                        <DropdownMenuSeparator key={i} />
                    ) : (
                        <DropdownMenuItem key={item.text} onClick={item.run}>
                            {item.text}
                        </DropdownMenuItem>
                    ),
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function MapMenu() {
    const menu = useAppStore((state) => state.mapMenu);
    // a new key on each opening: a menu at a new point is a new menu, not a move of the open menu
    return menu ? <Menu key={`${menu.x},${menu.y}`} menu={menu} /> : null;
}
