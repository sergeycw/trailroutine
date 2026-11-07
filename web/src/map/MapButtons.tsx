import { AttributionControl, GeolocateControl, ScaleControl, useMap } from '@vis.gl/react-maplibre';
import { BinocularsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/state/context';
import { useStreetView } from '@/streetview/context';
import { ControlPortal } from './control-portal';
import { forgetPosition, savePosition } from './locate';

// The map buttons on the right under the quick layers (three zones, design layout-three-zones and layer-thumbnails):
// Street View, zoom as a capsule, MapLibre geolocation; the scale bar and the attribution are at the bottom left
// (design map-chrome). Custom controls use ControlPortal (control-portal.tsx). The controls look like round glass, the
// rules are in index.css.

// Zoom: buttons with the markup and the classes of the MapLibre NavigationControl (the icons come from its CSS, the
// tests look for .maplibregl-ctrl-zoom-in), as a capsule without the zoom number (design layout-three-zones); the zoom
// is necessary only to disable the buttons at the limits. There is no compass: the map rotation is off (BaseMap)
function ZoomControl() {
    const { current } = useMap();
    const map = current?.getMap();
    const [zoom, setZoom] = useState(() => map?.getZoom() ?? 0);
    useEffect(() => {
        if (!map) {
            return;
        }
        const update = () => setZoom(map.getZoom());
        update();
        map.on('zoom', update);
        return () => {
            map.off('zoom', update);
        };
    }, [map]);
    return (
        <ControlPortal className="maplibregl-ctrl-group">
            <button
                type="button"
                className="maplibregl-ctrl-zoom-in"
                aria-label="Zoom in"
                title="Zoom in"
                disabled={map !== undefined && zoom >= map.getMaxZoom()}
                onClick={(event) => map?.zoomIn({}, { originalEvent: event.nativeEvent })}
            >
                <span className="maplibregl-ctrl-icon" aria-hidden="true" />
            </button>
            <button
                type="button"
                className="maplibregl-ctrl-zoom-out"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={map !== undefined && zoom <= map.getMinZoom()}
                onClick={(event) => map?.zoomOut({}, { originalEvent: event.nativeEvent })}
            >
                <span className="maplibregl-ctrl-icon" aria-hidden="true" />
            </button>
        </ControlPortal>
    );
}

// Street View mode (the button and Alt+P of the old panorama control; code, not key: on macOS Alt changes the
// character)
function StreetViewControl() {
    const streetView = useStreetView();
    const enabled = useAppStore((state) => state.streetView.enabled);
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            // in an input field, Option+P on macOS is the character «π», not Street View (the name field in the
            // editor, Rename)
            const target = event.target instanceof HTMLElement ? event.target : null;
            if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) {
                return;
            }
            if (event.altKey && event.code === 'KeyP') {
                event.preventDefault();
                streetView.toggle();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [streetView]);
    return (
        <ControlPortal className="maplibregl-ctrl-group">
            <button
                type="button"
                // the MapLibre CSS outside @layer sets display: block and a transparent background on the group
                // buttons: flex and the pressed background need !
                className={cn(
                    'flex! items-center justify-center [&_svg]:size-[18px]',
                    enabled && 'bg-primary! text-primary-foreground',
                )}
                aria-label="Street View"
                title="Street View (Alt+P)"
                aria-pressed={enabled}
                onClick={() => streetView.toggle()}
            >
                <BinocularsIcon />
            </button>
        </ControlPortal>
    );
}

// The error texts are locationErrorMessage of the old client (src/App.js)
export function geolocationErrorMessage(code: number, message: string): string {
    switch (code) {
        case 0:
            return 'Your browser does not support geolocation.';
        case 1:
            return 'Geolocation is blocked for this site. Please, enable in browser setting.';
        case 2:
            return 'Failed to acquire position for unknown reason.';
        default:
            return `Geolocation error: ${message}`;
    }
}

// A disabled geolocation button (access denied before, or no API) gets no click, and the tooltip «Location not
// available» shows only on hover, which is not possible on a phone (spec web-client, «Геолокация недоступна»). While
// the button is disabled, it lets the pointer through, and the control container catches the click: a toast with the
// reason
function useDisabledGeolocateToast(notify: (title: string) => void) {
    const { current } = useMap();
    const map = current?.getMap();
    useEffect(() => {
        const button = map?.getContainer().querySelector<HTMLButtonElement>('.maplibregl-ctrl-geolocate');
        const group = button?.parentElement;
        if (!button || !group) {
            return;
        }
        // the button holds the tooltip «Location not available»; while the button lets the pointer through, the group
        // has the same tooltip
        const sync = () => {
            button.style.pointerEvents = button.disabled ? 'none' : '';
            group.title = button.disabled ? button.title : '';
        };
        sync();
        const observer = new MutationObserver(sync);
        observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
        const onClick = (event: MouseEvent) => {
            if (button.disabled && event.target === group) {
                notify('geolocation' in navigator ? geolocationErrorMessage(1, '') : geolocationErrorMessage(0, ''));
            }
        };
        group.addEventListener('click', onClick);
        return () => {
            observer.disconnect();
            group.removeEventListener('click', onClick);
        };
    }, [map, notify]);
}

// The attribution is an (i) button on a computer too: it is expanded at the start, and any map move by the user
// collapses it (OSMF guide https://osmfoundation.org/wiki/Attribution, «Fading or collapsing»; design map-chrome).
// MapLibre with compact collapses it only on drag, but the wheel, a pinch and the zoom buttons are moves too. To
// collapse, do the same as its _updateCompactMinimize: remove the class maplibregl-compact-show. Programmatic moves
// (the view from the address, fitBounds of tracks, geolocation at the visit) do not carry originalEvent and do not
// collapse the attribution
function useCollapseAttributionOnMove() {
    const { current } = useMap();
    const map = current?.getMap();
    useEffect(() => {
        if (!map) {
            return;
        }
        const collapse = (event: { originalEvent?: Event }) => {
            if (event.originalEvent) {
                map.getContainer()
                    .querySelector('.maplibregl-ctrl-attrib')
                    ?.classList.remove('maplibregl-compact-show');
            }
        };
        map.on('movestart', collapse);
        return () => {
            map.off('movestart', collapse);
        };
    }, [map]);
}

export interface MapButtonsProps {
    notify: (title: string) => void;
    storage: Storage | null;
}

export function MapButtons({ notify, storage }: MapButtonsProps) {
    useDisabledGeolocateToast(notify);
    useCollapseAttributionOnMove();
    return (
        <>
            <StreetViewControl />
            <ZoomControl />
            <GeolocateControl
                position="top-right"
                trackUserLocation
                // MapLibre has a 6 s timeout: on a phone the first GPS fix takes longer; the old one had no timeout
                positionOptions={{ enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 }}
                // maxAutoZoom 17 of the old client, in MapLibre zoom
                fitBoundsOptions={{ maxZoom: 16 }}
                onGeolocate={(event) =>
                    savePosition(storage, { lat: event.coords.latitude, lng: event.coords.longitude })
                }
                onError={(event) => {
                    if (event.code === 1) {
                        forgetPosition(storage);
                    }
                    notify(geolocationErrorMessage(event.code, event.message));
                }}
            />
            {/* the attribution and the scale bar at the bottom left: at the bottom center is the profile button
                (MapActions); MapLibre puts each next bottom control higher, so the scale bar is above the attribution.
                maxWidth 80 (MapLibre has 100): the collapsed column fits to the left of the profile button on a phone
                (design map-chrome) */}
            <AttributionControl position="bottom-left" compact />
            <ScaleControl position="bottom-left" unit="metric" maxWidth={80} />
        </>
    );
}
