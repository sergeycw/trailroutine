import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Elevation, ProfileSamples } from '@/elevation/profile';
import type { LayerDef } from '@/layers/catalog';
import { type CustomLayerFields, customLayerDef, parseCustomLayerCode, serializeCustomLayer } from '@/layers/custom';
import { type QuickLayerGroup, rememberQuickLayer } from '@/layers/quick-layers';
import { BASEMAP_FALLBACKS, type ParsedLayers, validSelection } from '@/layers/selection';
import type { LayerSettings, Selection } from '@/layers/settings';
import type { End } from '@/routing/editor';
import type { RouteLine } from '@/routing/line';
import type { LinePlace } from '@/routing/line-tools';
import { DEFAULT_HIKING_OPTIONS, type HikingOptions } from '@/routing/options';
import type { Placemark } from '@/search/placemark';
import type { PanoView } from '@/streetview/hash';
import { parseTrackColor } from '@/tracks/color';
import type { Bounds } from '@/tracks/geometry';
import { type GeoData, type LatLng, TRACK_COLORS, type Track, type Waypoint } from '@/tracks/model';
import type { View } from './hash';

// The app state that the map, the layer switcher and the address share. The store is created for each App instance
// (context), not as a module singleton: browser tests render App many times in one page.

export interface AppState {
    catalog: readonly LayerDef[];
    // catalog + custom layers; rebuilt when custom layers change
    layers: ReadonlyMap<string, LayerDef>;
    settings: LayerSettings;
    selection: Selection;
    // the basemap from which the fallback along the chain BASEMAP_FALLBACKS started after its tile error (design
    // add-outdoor-basemap, «Откат на OpenStreetMap»; the chain: design openfreemap-default-basemap): a fallback is not
    // a user selection, localStorage and l= get the selection with this basemap (savedSelection). The field keeps Of
    // after the fallback Of → Tt → O
    basemapFallback: string | null;
    // the date of the dated imagery YYYY-MM-DD (design add-dated-imagery): in the address d= while the basemap is a
    // layer with dated; it does not go to localStorage. null: no date, the layer is not drawn
    imageryDate: string | null;
    // the last map view (the map writes it on moveend)
    view: View;
    // the view to move the map to (it came from the address); seq tells identical requests apart
    viewRequest: { view: View; seq: number } | null;
    // bounds that the map must show in full (a track, loaded tracks)
    boundsRequest: { bounds: Bounds; seq: number } | null;
    // the track list from top to bottom (design add-web-tracks, «Стор»)
    tracks: readonly Track[];
    // the color of the next track without its own color: in a cycle, as _lastTrackColor of the old client
    nextColor: number;
    // how many track loads (files, links, address parameters) run now
    loadingTracks: number;
    // text that could not go to the clipboard (a link to tracks, point coordinates): a dialog shows it
    copyFallback: CopyFallback | null;
    // routing (design add-web-route-editor, «Связь со стором и картой»): the selected activity or null («Off»), whether
    // the router is alive (red button), the edited line and the index of the dragged waypoint: what the map draws. The
    // map draws the drag preview and the rubber band past the store (routing/MapEditor.tsx).
    routingActivity: string | null;
    // options of the hiking profile for the next routed legs (routing/options.ts)
    hikingOptions: HikingOptions;
    routerReachable: boolean;
    routeEdit: RouteEditState | null;
    routeDrag: number | null;
    // line tools and track points (design add-web-line-tools): the map choice for Join and Shortcut, the menu at a map
    // point, the mode to place or move a track point and its name dialog
    lineTool: LineTool | null;
    mapMenu: MapMenu | null;
    pointTool: PointTool | null;
    pointDialog: PointDialog | null;
    // the elevation profile (design add-web-elevation-profile): what is shown, samples and elevations, the cursor and
    // the selection are fractional sample point indexes; the panel and the map share the cursor and the selection
    profile: ProfileTarget | null;
    profileData: ProfileData | null;
    profileCursor: number | null;
    profileSelection: readonly [number, number] | null;
    // the placemark of a found place (design add-web-search-panoramas, «Метка»): it lives in the address r=
    placemark: Placemark | null;
    // Street View (design add-web-search-panoramas, «Street View: режим, клик, окно»): the mode, the shown panorama
    // (the panel is open while it exists; the panorama window writes it) and the request to the window to go to a view
    // (a map click, the address)
    streetView: StreetViewState;

    setView(view: View): void;
    requestView(view: View): void;
    selectBase(code: string): void;
    setImageryDate(date: string | null): void;
    // move the basemap code to the next one in BASEMAP_FALLBACKS; false: code is not the basemap any more (tile errors
    // come also after a layer change) or it has no fallback
    fallBackBase(code: string): boolean;
    toggleOverlay(code: string): void;
    // a column group overlay instead of its other overlays (menu and button in QuickLayers); null: turn off the group
    setQuickOverlay(group: QuickLayerGroup, code: string | null): void;
    applyLayersParam(parsed: ParsedLayers): void;
    updateSettings(patch: Partial<Pick<LayerSettings, 'listed'>>): void;
    // return the layer code
    addCustomLayer(fields: CustomLayerFields): string;
    replaceCustomLayer(code: string, fields: CustomLayerFields): string;
    removeCustomLayer(code: string): void;
    requestBounds(bounds: Bounds): void;
    // the data is already prepared by prepareImport (lines are simplified); returns the added tracks. atStart: to the
    // start of the list (the restored working set, design add-web-autosave, «Восстановление и треки из адреса»)
    addTracks(data: readonly GeoData[], atStart?: boolean): Track[];
    // new segments without routes reset the route markup: an edit that does not know about the markup does not leave
    // waypoint indexes that point to wrong places (design add-web-route-editor, «Разметка маршрута в треке»)
    updateTrack(
        id: string,
        patch: Partial<
            Pick<Track, 'name' | 'color' | 'visible' | 'segments' | 'points' | 'routes' | 'measureTicksShown'>
        >,
    ): void;
    removeTracks(ids: readonly string[]): void;
    changeLoadingTracks(delta: number): void;
    setCopyFallback(fallback: CopyFallback | null): void;
    setRoutingActivity(id: string | null): void;
    setHikingOptions(options: HikingOptions): void;
    setRouterReachable(reachable: boolean): void;
    setRouteEdit(edit: RouteEditState | null): void;
    setRouteDrag(index: number | null): void;
    setLineTool(tool: LineTool | null): void;
    setMapMenu(menu: MapMenu | null): void;
    setPointTool(tool: PointTool | null): void;
    setPointDialog(dialog: PointDialog | null): void;
    setProfile(profile: ProfileTarget | null): void;
    setProfileData(data: ProfileData | null): void;
    setProfileCursor(cursor: number | null): void;
    setProfileSelection(selection: readonly [number, number] | null): void;
    setPlacemark(placemark: Placemark | null): void;
    // turning off the mode closes the panorama
    setStreetViewEnabled(enabled: boolean): void;
    // open the panorama in this view (or move the open one)
    requestPano(view: PanoView): void;
    // the panorama window reports the current view; null: the panorama is closed
    setPano(view: PanoView | null): void;
}

export interface StreetViewState {
    enabled: boolean;
    pano: PanoView | null;
    request: { view: PanoView; seq: number } | null;
}

// segment null: the profile of the whole track
export interface ProfileTarget {
    trackId: string;
    segment: number | null;
}

// values: elevations of the sample points (null: no data), null while there are no elevations. updating: a rebuild
// runs, the previous profile is visible. error: the reason of the elevation API error.
export interface ProfileData {
    samples: ProfileSamples;
    values: readonly Elevation[] | null;
    updating: boolean;
    error: string | null;
}

// Map choice: Join from the end of the edited line, Shortcut from a place on it
export type LineTool = { kind: 'join'; end: End } | { kind: 'shortcut'; from: LinePlace };

// What is under the menu: a waypoint or a place on the line of the edited segment, a track point
export type MenuTarget =
    | { kind: 'waypoint'; index: number }
    | { kind: 'line'; place: { leg: number; latlng: LatLng } }
    | { kind: 'point'; trackId: string; point: Waypoint };

// x, y: screen coordinates (clientX/clientY), the menu stands there
export interface MapMenu {
    x: number;
    y: number;
    target: MenuTarget;
}

// A track point is a Waypoint object from the store, not an index: the index is found at the time of the action, a
// missing point does nothing
export type PointTool = { kind: 'add'; trackId: string } | { kind: 'move'; trackId: string; point: Waypoint };

export interface CopyFallback {
    title: string;
    text: string;
}

export interface PointDialog {
    trackId: string;
    point: Waypoint;
}

export interface RouteEditState {
    trackId: string;
    segment: number;
    line: RouteLine;
    // drawing: a click puts new points at this end of the line
    drawing: End | null;
    canUndo: boolean;
    canRedo: boolean;
    // the editor edit number (RouteEditor.revision): a router response does not change it
    revision: number;
}

export type AppStore = StoreApi<AppState>;

export interface AppStoreInit {
    catalog: readonly LayerDef[];
    corsProxyUrl: string;
    settings: LayerSettings;
    selection: Selection;
    view: View;
    imageryDate?: string | null;
    routingActivity?: string | null;
    hikingOptions?: HikingOptions;
    placemark?: Placemark | null;
    streetView?: { enabled: boolean; pano: PanoView | null };
}

function layersMap(catalog: readonly LayerDef[], custom: readonly string[], corsProxyUrl: string) {
    const layers = new Map(catalog.map((layer) => [layer.code, layer]));
    for (const code of custom) {
        const fields = parseCustomLayerCode(code);
        if (fields) {
            layers.set(code, customLayerDef(code, fields, corsProxyUrl));
        }
    }
    return layers;
}

function renameKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
    if (!(from in record)) {
        return record;
    }
    const { [from]: value, ...rest } = record;
    return { ...rest, [to]: value };
}

// track ids are unique per page (and between store instances in browser tests, which is not a problem)
let lastTrackId = 0;

export function createAppStore(init: AppStoreInit): AppStore {
    return createStore<AppState>()((set, get) => {
        // custom layers changed: rebuild the layer map and remove the missing layers from the selection
        function withCustom(settings: LayerSettings, selection: Selection) {
            const layers = layersMap(init.catalog, settings.custom, init.corsProxyUrl);
            return { settings, layers, selection: validSelection(selection, layers) };
        }

        const initial = withCustom(init.settings, init.selection);
        return {
            catalog: init.catalog,
            ...initial,
            basemapFallback: null,
            imageryDate: init.imageryDate ?? null,
            view: init.view,
            viewRequest: null,
            boundsRequest: null,
            tracks: [],
            nextColor: 0,
            loadingTracks: 0,
            copyFallback: null,
            routingActivity: init.routingActivity ?? null,
            hikingOptions: init.hikingOptions ?? DEFAULT_HIKING_OPTIONS,
            routerReachable: true,
            routeEdit: null,
            routeDrag: null,
            lineTool: null,
            mapMenu: null,
            pointTool: null,
            pointDialog: null,
            profile: null,
            profileData: null,
            profileCursor: null,
            profileSelection: null,
            placemark: init.placemark ?? null,
            streetView: {
                enabled: init.streetView?.enabled ?? false,
                pano: init.streetView?.pano ?? null,
                request: init.streetView?.pano ? { view: init.streetView.pano, seq: 1 } : null,
            },

            setView: (view) => set({ view }),
            requestView: (view) => set({ view, viewRequest: { view, seq: (get().viewRequest?.seq ?? 0) + 1 } }),

            setImageryDate: (imageryDate) => set({ imageryDate }),

            selectBase: (code) => {
                const { selection, layers, settings, basemapFallback } = get();
                if (layers.get(code)?.isOverlay !== false) {
                    return;
                }
                // the circle of its group remembers the user selection (design quick-layer-menus), also when the
                // basemap is already on the map: a press on the marked circle after old settings without the memory
                const quickLayers = rememberQuickLayer(settings.quickLayers, code);
                // an explicit selection of the fallback basemap is already a user selection: the fallback resets,
                // although the basemap is the same
                if (selection.base === code && !basemapFallback && quickLayers === settings.quickLayers) {
                    return;
                }
                set({
                    selection: selection.base === code ? selection : { ...selection, base: code },
                    basemapFallback: null,
                    settings: quickLayers === settings.quickLayers ? settings : { ...settings, quickLayers },
                });
            },

            fallBackBase: (code) => {
                const { selection, basemapFallback } = get();
                const next = BASEMAP_FALLBACKS[code];
                if (selection.base !== code || !next) {
                    return false;
                }
                set({ selection: { ...selection, base: next }, basemapFallback: basemapFallback ?? code });
                return true;
            },

            toggleOverlay: (code) => {
                const { selection, layers, settings } = get();
                if (!layers.get(code)?.isOverlay) {
                    return;
                }
                if (selection.overlays.includes(code)) {
                    set({ selection: { ...selection, overlays: selection.overlays.filter((item) => item !== code) } });
                    return;
                }
                // the button of the column group remembers an overlay that is turned on (design quick-layer-menus)
                const quickLayers = rememberQuickLayer(settings.quickLayers, code);
                set({
                    selection: { ...selection, overlays: [...selection.overlays, code] },
                    settings: quickLayers === settings.quickLayers ? settings : { ...settings, quickLayers },
                });
            },

            setQuickOverlay: (group, code) => {
                const { selection, layers, settings } = get();
                if (code !== null && (!group.codes.includes(code) || !layers.get(code)?.isOverlay)) {
                    return;
                }
                const others = selection.overlays.filter((item) => !group.codes.includes(item));
                const quickLayers =
                    code === null ? settings.quickLayers : rememberQuickLayer(settings.quickLayers, code);
                set({
                    selection: { ...selection, overlays: code === null ? others : [...others, code] },
                    settings: quickLayers === settings.quickLayers ? settings : { ...settings, quickLayers },
                });
            },

            // l= from the address: custom layers from the link go to the list, and all layers of the link become
            // visible in the switcher, as unserializeState of the old client does (layer.enabled = true)
            applyLayersParam: ({ selection, custom }) => {
                const { settings } = get();
                const listed = { ...settings.listed };
                for (const code of [selection.base, ...selection.overlays]) {
                    listed[code] = true;
                }
                const merged = [...settings.custom, ...custom.filter((code) => !settings.custom.includes(code))];
                // the layers of the link are also the last selected ones in their groups; the fallback (fallBackBase)
                // does not touch the memory
                const quickLayers = [selection.base, ...selection.overlays].reduce(
                    rememberQuickLayer,
                    settings.quickLayers,
                );
                set({
                    ...withCustom({ ...settings, listed, custom: merged, quickLayers }, selection),
                    basemapFallback: null,
                });
            },

            updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

            addCustomLayer: (fields) => {
                const code = serializeCustomLayer(fields);
                const { settings, selection } = get();
                const custom = settings.custom.includes(code) ? settings.custom : [...settings.custom, code];
                // a new layer is turned on immediately: a basemap replaces the current one, an overlay is added
                const next = fields.isOverlay
                    ? { ...selection, overlays: [...selection.overlays.filter((item) => item !== code), code] }
                    : { ...selection, base: code };
                set(withCustom({ ...settings, custom, listed: { ...settings.listed, [code]: true } }, next));
                return code;
            },

            replaceCustomLayer: (oldCode, fields) => {
                const code = serializeCustomLayer(fields);
                const { settings, selection } = get();
                const custom = settings.custom.map((item) => (item === oldCode ? code : item));
                const wasBase = selection.base === oldCode;
                const wasOverlay = selection.overlays.includes(oldCode);
                // an empty basemap: validSelection returns the default
                const next = {
                    base: wasBase ? '' : selection.base,
                    overlays: selection.overlays.filter((item) => item !== oldCode),
                };
                // a layer that is on stays on in its new role, except an overlay that became a basemap
                // (onCustomLayerChangeClicked of the old client)
                if (wasBase || (wasOverlay && fields.isOverlay)) {
                    if (fields.isOverlay) {
                        next.overlays.push(code);
                    } else {
                        next.base = code;
                    }
                }
                set(
                    withCustom(
                        {
                            ...settings,
                            custom: [...new Set(custom)],
                            listed: renameKey(settings.listed, oldCode, code),
                        },
                        next,
                    ),
                );
                return code;
            },

            requestBounds: (bounds) => set({ boundsRequest: { bounds, seq: (get().boundsRequest?.seq ?? 0) + 1 } }),

            addTracks: (data, atStart = false) => {
                let { nextColor } = get();
                const added = data.map((item): Track => {
                    let color = parseTrackColor(item.color);
                    if (color === null) {
                        color = nextColor;
                        nextColor = (nextColor + 1) % TRACK_COLORS.length;
                    }
                    lastTrackId += 1;
                    return {
                        id: `track-${lastTrackId}`,
                        name: item.name,
                        segments: item.segments,
                        points: item.points,
                        color,
                        visible: !item.hidden,
                        measureTicksShown: item.measureTicksShown ?? false,
                        ...(item.routes ? { routes: item.routes } : {}),
                    };
                });
                set({ tracks: atStart ? [...added, ...get().tracks] : [...get().tracks, ...added], nextColor });
                return added;
            },

            updateTrack: (id, patch) => {
                const reset = 'segments' in patch && !('routes' in patch) ? { routes: undefined } : {};
                set({
                    tracks: get().tracks.map((track) => (track.id === id ? { ...track, ...reset, ...patch } : track)),
                });
            },

            removeTracks: (ids) => set({ tracks: get().tracks.filter((track) => !ids.includes(track.id)) }),

            changeLoadingTracks: (delta) => set({ loadingTracks: get().loadingTracks + delta }),
            setCopyFallback: (copyFallback) => set({ copyFallback }),
            setRoutingActivity: (routingActivity) => set({ routingActivity }),
            setHikingOptions: (hikingOptions) => set({ hikingOptions }),
            setRouterReachable: (routerReachable) => set({ routerReachable }),
            setRouteEdit: (routeEdit) => set({ routeEdit }),
            setRouteDrag: (routeDrag) => set({ routeDrag }),
            setLineTool: (lineTool) => set({ lineTool }),
            setMapMenu: (mapMenu) => set({ mapMenu }),
            setPointTool: (pointTool) => set({ pointTool }),
            setPointDialog: (pointDialog) => set({ pointDialog }),
            setProfile: (profile) => set({ profile, profileData: null, profileCursor: null, profileSelection: null }),
            setProfileData: (profileData) => set({ profileData }),
            setProfileCursor: (profileCursor) => set({ profileCursor }),
            setProfileSelection: (profileSelection) => set({ profileSelection }),
            setPlacemark: (placemark) => set({ placemark }),
            setStreetViewEnabled: (enabled) => {
                const { streetView } = get();
                if (streetView.enabled === enabled) {
                    return;
                }
                set({ streetView: enabled ? { ...streetView, enabled } : { enabled, pano: null, request: null } });
            },
            requestPano: (view) => {
                const { streetView } = get();
                set({
                    streetView: {
                        enabled: true,
                        pano: view,
                        request: { view, seq: (streetView.request?.seq ?? 0) + 1 },
                    },
                });
            },
            setPano: (pano) => {
                const { streetView } = get();
                if (!streetView.enabled) {
                    return;
                }
                set({ streetView: { ...streetView, pano, request: pano ? streetView.request : null } });
            },

            removeCustomLayer: (code) => {
                const { settings, selection } = get();
                const { [code]: _listed, ...listed } = settings.listed;
                set(withCustom({ ...settings, listed, custom: settings.custom.filter((c) => c !== code) }, selection));
            },
        };
    });
}

// The selection for localStorage and l=: while the map is on the fallback basemap, the basemap that the fallback
// started from is saved, and the next visit and a reload try it again. Another basemap (a custom layer, a basemap
// removal) means that the fallback is no longer relevant
export function savedSelection(state: Pick<AppState, 'selection' | 'basemapFallback'>): Selection {
    const { selection, basemapFallback } = state;
    if (!basemapFallback || !fallbackChain(basemapFallback).includes(selection.base)) {
        return selection;
    }
    return { ...selection, base: basemapFallback };
}

// the basemaps to which code falls back along the chain BASEMAP_FALLBACKS, in order: Of → [Tt, O]
function fallbackChain(code: string): string[] {
    const chain: string[] = [];
    for (let next = BASEMAP_FALLBACKS[code]; next && !chain.includes(next); next = BASEMAP_FALLBACKS[next]) {
        chain.push(next);
    }
    return chain;
}
