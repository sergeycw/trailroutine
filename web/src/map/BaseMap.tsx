import { Map as MapLibreMap, type MapRef } from '@vis.gl/react-maplibre';
import type { RequestTransformFunction } from 'maplibre-gl';
import { type ReactNode, type Ref, useCallback, useEffect, useMemo, useRef } from 'react';
import { ProfileOnMap } from '@/elevation/ProfileOnMap';
import { PROFILE_SOURCES } from '@/elevation/style';
import type { LayerDef } from '@/layers/catalog';
import { withDate } from '@/layers/dated';
import { buildStyle, layerCodeOfSource } from '@/layers/style';
import { editSources } from '@/routing/edit-style';
import { MapEditor } from '@/routing/MapEditor';
import { RoutingBadgeOnMap } from '@/routing/RoutingBadgeOnMap';
import { ToolHintOnMap } from '@/routing/ToolHintOnMap';
import { PlacemarkOnMap } from '@/search/PlacemarkOnMap';
import { useAppStore } from '@/state/context';
import { COVERAGE_LAYER } from '@/streetview/coverage';
import { StreetViewOnMap } from '@/streetview/StreetViewOnMap';
import { trackColor } from '@/tracks/model';
import { TRACK_TICKS, trackSources } from '@/tracks/style';
import { ticksData } from '@/tracks/ticks';
import { maplibre } from './maplibre';

interface BaseMapProps {
    // a layer source error: the layer code, the HTTP status if there is one, and whether it is a tile error (otherwise,
    // an error of the source itself: the TileJSON tile description of the vector basemap)
    onTileError: (code: string, status: number | undefined, tile: boolean) => void;
    // a layer tile loaded (basemap fallback: single failures of a basemap that is already shown do not cause its
    // fallback)
    onTileLoad?: (code: string) => void;
    // tests replace the tile addresses with a fixture (the tests do not go to the network)
    transformRequest?: RequestTransformFunction;
    ref?: Ref<MapRef>;
    // controls and layers over the map from App (the map buttons)
    children?: ReactNode;
}

// The map fills the container. isolate: the z-index of the MapLibre controls (2) stays inside the stacking context
// of the map, and the app panels are above them without a z-index race (design add-web-skeleton, «Проверки»).
// The map is uncontrolled: the view goes to the store on moveend, and a request from the address (viewRequest) moves
// it with jumpTo.
export function BaseMap({ onTileError, onTileLoad, transformRequest, ref, children }: BaseMapProps) {
    const selection = useAppStore((state) => state.selection);
    const layers = useAppStore((state) => state.layers);
    const imageryDate = useAppStore((state) => state.imageryDate);
    const initialView = useAppStore((state) => state.view);
    const viewRequest = useAppStore((state) => state.viewRequest);
    const boundsRequest = useAppStore((state) => state.boundsRequest);
    const tracks = useAppStore((state) => state.tracks);
    const routeEdit = useAppStore((state) => state.routeEdit);
    const routeDrag = useAppStore((state) => state.routeDrag);
    const setView = useAppStore((state) => state.setView);
    const streetViewOn = useAppStore((state) => state.streetView.enabled);
    // the distance marks rebuild at a whole zoom (design add-web-search-panoramas, «Отметки расстояния и линейка»)
    // floor, not round: at a fractional zoom, the step uses the smaller scale, so the marks are not closer than 15 mm
    const ticksZoom = useAppStore((state) => Math.floor(state.view.zoom));
    const mapRef = useRef<MapRef | null>(null);
    // react-maplibre gives the reference when the map is created (MapLibre loads lazily), after the first render,
    // so the outer reference is a callback ref, not useImperativeHandle
    const setMapRef = useCallback(
        (instance: MapRef | null) => {
            mapRef.current = instance;
            if (typeof ref === 'function') {
                ref(instance);
            } else if (ref) {
                ref.current = instance;
            }
        },
        [ref],
    );

    // The track and editor sources are built separately: a drag and the rubber band change only the editor sources,
    // the tracks rebuild when the tracks or the edited segment change (design add-web-route-editor, «Отрисовка»)
    const editTrackId = routeEdit?.trackId;
    const editSegment = routeEdit?.segment;
    const trackData = useMemo(
        () =>
            trackSources(
                tracks,
                editTrackId === undefined || editSegment === undefined
                    ? null
                    : { trackId: editTrackId, segment: editSegment },
            ),
        [tracks, editTrackId, editSegment],
    );
    const editColor = trackColor(tracks.find((track) => track.id === editTrackId)?.color);
    const editData = useMemo(() => editSources(routeEdit, editColor, routeDrag), [routeEdit, editColor, routeDrag]);
    const ticks = useMemo(() => ticksData(tracks, ticksZoom), [tracks, ticksZoom]);
    const mapStyle = useMemo(() => {
        // the dated imagery layer without a date does not go into the style: tiles for a random date do not load
        // (design add-dated-imagery)
        const defs = [selection.base, ...selection.overlays].flatMap((code): LayerDef[] => {
            const layer = layers.get(code);
            if (!layer?.dated) {
                return layer ? [layer] : [];
            }
            return imageryDate ? [withDate(layer, imageryDate)] : [];
        });
        // the Street View coverage is above the catalog layers, under the profile and the tracks (design
        // add-web-search-panoramas)
        if (streetViewOn) {
            defs.push(COVERAGE_LAYER);
        }
        return buildStyle(defs, {
            ...trackData.sources,
            [TRACK_TICKS]: { type: 'geojson', data: ticks },
            ...editData,
            ...PROFILE_SOURCES,
        });
    }, [selection, layers, imageryDate, streetViewOn, trackData, ticks, editData]);

    useEffect(() => {
        if (viewRequest) {
            const { lat, lng, zoom } = viewRequest.view;
            mapRef.current?.jumpTo({ center: [lng, lat], zoom });
        }
    }, [viewRequest]);

    // A "show the bounds" request can come before the map is created (tracks from the address load at the start, and
    // MapLibre loads lazily): then onLoad applies it. appliedBounds prevents one request from applying twice.
    const appliedBounds = useRef(0);
    const fitRequestedBounds = useCallback(() => {
        const map = mapRef.current;
        if (!map || !boundsRequest || appliedBounds.current === boundsRequest.seq) {
            return;
        }
        appliedBounds.current = boundsRequest.seq;
        const { west, south, east, north } = boundsRequest.bounds;
        // maxZoom 16 of the old client (setViewToBounds), 1 less in MapLibre zoom
        map.fitBounds(
            [
                [west, south],
                [east, north],
            ],
            { maxZoom: 15, padding: 40, duration: 0 },
        );
    }, [boundsRequest]);
    useEffect(fitRequestedBounds, [fitRequestedBounds]);

    return (
        // the right column is MapLibre controls: the quick layers (LayerSwitcher), under them the map buttons
        // (MapButtons); top-1 = 4 px + the control margin 8 px (index.css) = 12 px from the edge, as for the panels on
        // the left. With !important: the MapLibre CSS is connected outside @layer and without it overrides the
        // Tailwind utility with its top: 0. The attribution and the scale bar at the bottom left are rules in index.css
        <div className="absolute inset-0 isolate [&_.maplibregl-ctrl-top-right]:top-1!" data-testid="map">
            <MapLibreMap
                ref={setMapRef}
                mapLib={maplibre}
                initialViewState={{ latitude: initialView.lat, longitude: initialView.lng, zoom: initialView.zoom }}
                mapStyle={mapStyle}
                transformRequest={transformRequest}
                // the attribution is its own control at the bottom left (MapButtons), as the scale bar
                attributionControl={false}
                // no rotation and no pitch, as in the old client: mockup 4a has no compass, and without it a rotated
                // map cannot go back to north (design polish-web-ui)
                dragRotate={false}
                pitchWithRotate={false}
                touchPitch={false}
                onLoad={(event) => {
                    // otherwise a two-finger gesture and Shift+arrows rotate and pitch the map
                    event.target.touchZoomRotate.disableRotation();
                    event.target.keyboard.disableRotation();
                    fitRequestedBounds();
                }}
                style={{ width: '100%', height: '100%' }}
                onMoveEnd={(event) => {
                    const center = event.target.getCenter().wrap();
                    setView({ lat: center.lat, lng: center.lng, zoom: event.target.getZoom() });
                }}
                onError={(event) => {
                    // a tile error comes as a map event with sourceId of the source (= the layer code, for dated
                    // imagery code@index), tile and AJAXError with status; a tile description error (TileJSON) comes
                    // without tile; other errors go to the MapLibre console
                    const { sourceId, error, tile } = event as {
                        sourceId?: string;
                        error?: { status?: number };
                        tile?: unknown;
                    };
                    if (sourceId) {
                        onTileError(layerCodeOfSource(sourceId), error?.status, tile !== undefined);
                    }
                }}
                onSourceData={(event) => {
                    if (event.tile && event.sourceId) {
                        onTileLoad?.(layerCodeOfSource(event.sourceId));
                    }
                }}
            >
                {children}
                <MapEditor />
                <ToolHintOnMap />
                <RoutingBadgeOnMap />
                <ProfileOnMap />
                <PlacemarkOnMap />
                <StreetViewOnMap />
            </MapLibreMap>
        </div>
    );
}
