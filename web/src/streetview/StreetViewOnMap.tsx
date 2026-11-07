import { Marker, useMap } from '@vis.gl/react-maplibre';
import { Navigation2Icon } from 'lucide-react';
import { useEffect } from 'react';
import { useAppStore } from '@/state/context';

// The panorama marker on the map (PanoMarker of the old client): the position of the window, turned to the view
// direction. If the window goes out of the visible part (5 % from the edge, bounds.pad(-0.05) of the old client; the
// visible part is above the bottom panels), the map moves to it.
export function StreetViewOnMap() {
    const { current } = useMap();
    const map = current?.getMap();
    const pano = useAppStore((state) => state.streetView.pano);
    const lat = pano?.lat;
    const lng = pano?.lng;

    useEffect(() => {
        if (!map || lat === undefined || lng === undefined) {
            return;
        }
        // the visible part is above the bottom panels (panorama, elevation profile): the map is below them, but
        // it is not visible
        const canvas = map.getContainer().getBoundingClientRect();
        const panels = ['street-view-panel', 'elevation-profile']
            .map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect())
            .filter((rect): rect is DOMRect => Boolean(rect?.height));
        const bottom = Math.min(canvas.bottom, ...panels.map((rect) => rect.top)) - canvas.top;
        const point = map.project([lng, lat]);
        const padX = canvas.width * 0.05;
        const padY = bottom * 0.05;
        const inside = point.x > padX && point.x < canvas.width - padX && point.y > padY && point.y < bottom - padY;
        if (!inside) {
            // the center of the visible part, not of the full map: an offset down by half of the band that the
            // panels cover
            map.easeTo({ center: [lng, lat], offset: [0, (bottom - canvas.height) / 2] });
        }
    }, [map, lat, lng]);

    if (!pano) {
        return null;
    }
    return (
        <Marker longitude={pano.lng} latitude={pano.lat} rotation={pano.heading} rotationAlignment="map">
            <div
                className="flex size-7 items-center justify-center rounded-full bg-amber-400 shadow ring-2 ring-white"
                data-testid="panorama-marker"
                data-heading={Math.round(pano.heading)}
                style={{ pointerEvents: 'none' }}
            >
                <Navigation2Icon className="size-4 fill-white text-white" />
            </div>
        </Marker>
    );
}
