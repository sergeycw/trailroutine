import { Marker } from '@vis.gl/react-maplibre';
import { MapPinIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useRouteEditing } from '@/routing/editing-context';
import { nearTo } from '@/routing/MapEditor';
import { useAppStore, useAppStoreApi } from '@/state/context';
import { useTrackActions } from '@/tracks/actions-context';

// The placemark of a found place on the map (design add-web-search-panoramas, «Метка»): a pin and a name. A map click
// outside the placemark removes it (MapEditor.onClick). A click on the placemark while a track point is placed puts the
// point with the placemark name (suggestedPoint of the old client), and while a line is drawn, a waypoint; in these
// cases the native events of the element stop here, before the map (a React handler would be too late: React listens
// on the app root, and the map on its own container inside it).
export function PlacemarkOnMap() {
    const placemark = useAppStore((state) => state.placemark);
    const store = useAppStoreApi();
    const actions = useTrackActions();
    const editing = useRouteEditing();
    // native listeners on the placemark element: a ref callback with cleanup (React 19), the element appears together
    // with the placemark
    const attach = useCallback(
        (node: HTMLDivElement | null) => {
            if (!node) {
                return;
            }
            // the placemark serves only the placement of a track point and drawing; in other modes the click goes to
            // the map, as in the old client (a click on the placemark is a map click): it removes the placemark,
            // searches a panorama, moves a point
            const ours = () => {
                const state = store.getState();
                return state.pointTool?.kind === 'add' || Boolean(state.routeEdit?.drawing);
            };
            const stop = (event: Event) => {
                if (ours()) {
                    event.stopPropagation();
                }
            };
            const onClick = (event: Event) => {
                const state = store.getState();
                const mark = state.placemark;
                if (!mark || !ours()) {
                    return;
                }
                event.stopPropagation();
                const latlng = { lat: mark.lat, lng: mark.lng };
                const edit = state.routeEdit;
                if (state.pointTool?.kind === 'add') {
                    actions.addPoint(state.pointTool.trackId, latlng, mark.title);
                } else if (edit?.drawing) {
                    // the world copy nearest to the line, as for a map click
                    const anchor = edit.drawing === 'end' ? edit.line.waypoints.at(-1) : edit.line.waypoints[0];
                    editing.click(nearTo(latlng, anchor));
                }
                state.setPlacemark(null);
            };
            const events = ['mousedown', 'mouseup', 'dblclick', 'touchstart', 'touchend', 'contextmenu'];
            for (const type of events) {
                node.addEventListener(type, stop);
            }
            node.addEventListener('click', onClick);
            return () => {
                for (const type of events) {
                    node.removeEventListener(type, stop);
                }
                node.removeEventListener('click', onClick);
            };
        },
        [store, actions, editing],
    );

    if (!placemark) {
        return null;
    }
    return (
        <Marker longitude={placemark.lng} latitude={placemark.lat} anchor="bottom">
            <div
                ref={attach}
                className="flex cursor-pointer flex-col items-center"
                data-testid="placemark"
                title={placemark.title}
            >
                {placemark.title && (
                    <span className="mb-0.5 max-w-48 truncate rounded bg-white/90 px-1.5 py-0.5 font-medium text-xs shadow">
                        {placemark.title}
                    </span>
                )}
                <MapPinIcon className="size-7 fill-red-500 text-white drop-shadow" strokeWidth={1.5} />
            </div>
        </Marker>
    );
}
