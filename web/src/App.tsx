import type { MapRef } from '@vis.gl/react-maplibre';
import type { RequestTransformFunction } from 'maplibre-gl';
import { type Ref, useEffect, useRef, useState } from 'react';
import { type AutosaveStorage, startAutosave } from '@/autosave/autosave';
import { indexedDbStorage } from '@/autosave/idb';
import { legacySessionSource } from '@/autosave/legacy-session';
import { Toaster, toast } from '@/components/ui/toast';
import { config } from '@/config';
import { ElevationProfileContext } from '@/elevation/context';
import { createElevationProfile } from '@/elevation/controller';
import { ElevationProfile, PROFILE_HEIGHT } from '@/elevation/ElevationProfile';
import { getEngine } from '@/engine/engine';
import { createFallbackGate } from '@/layers/basemap-fallback';
import { buildCatalog } from '@/layers/catalog';
import { LayerSwitcher } from '@/layers/LayerSwitcher';
import { BASEMAP_FALLBACKS } from '@/layers/selection';
import { createRouteEditing } from '@/routing/editing';
import { RouteEditingContext } from '@/routing/editing-context';
import { MapMenu } from '@/routing/MapMenu';
import { createRouter, type Router } from '@/routing/router';
import { AppStoreContext, useAppStore } from '@/state/context';
import { parseHash, parseView } from '@/state/hash';
import type { AppStore } from '@/state/store';
import { bindAppStore, startAppStore } from '@/state/sync';
import type { StreetViewApi } from '@/streetview/api';
import { StreetViewContext } from '@/streetview/context';
import { createStreetView } from '@/streetview/controller';
import { COVERAGE_CODE, COVERAGE_TITLE } from '@/streetview/coverage';
import { googleStreetView } from '@/streetview/google';
import { panoramaHeight, StreetViewPanel } from '@/streetview/StreetViewPanel';
import { createTrackActions, type TrackActionsDeps } from '@/tracks/actions';
import { TrackActionsContext } from '@/tracks/actions-context';
import { isTrackParam } from '@/tracks/links';
import { CopyFallbackDialog, PointNameDialog } from '@/tracks/TrackDialogs';
import { BaseMap } from './map/BaseMap';
import { loadPosition, refreshPosition } from './map/locate';
import { MapActions } from './map/MapActions';
import { MapButtons } from './map/MapButtons';
import { TopBar } from './TopBar';

export function localStorageOrNull(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        // the access to the storage is blocked (site settings): the app works with the defaults
        return null;
    }
}

// A visit without a view and without tracks in the address starts at the last position of the user
// (moveMapToCurrentLocation of the old client)
function startsAtPosition(hash: string): boolean {
    const params = parseHash(hash);
    return !parseView(params.get('m')) && ![...params.keys()].some(isTrackParam);
}

function startStore(): AppStore {
    const [lat, lng] = config.defaultLocation;
    const position = startsAtPosition(window.location.hash) ? loadPosition(localStorageOrNull()) : null;
    return startAppStore({
        catalog: buildCatalog({
            pixelRatio: window.devicePixelRatio,
            language: navigator.language,
            corsProxyUrl: config.corsProxyUrl,
        }),
        corsProxyUrl: config.corsProxyUrl,
        defaultView: { ...(position ?? { lat, lng }), zoom: config.defaultZoom },
        hash: window.location.hash,
        storage: localStorageOrNull(),
    });
}

interface AppProps {
    transformRequest?: RequestTransformFunction;
    mapRef?: Ref<MapRef>;
    // the track network (storage, proxy) and the clipboard: the browser tests put in their own, and they do not use
    // the network
    fetch?: typeof fetch;
    writeClipboard?: TrackActionsDeps['writeClipboard'];
    // the router: the browser tests put in a fake one; by default, the engine or the server from config
    router?: Router;
    // the autosave storage of the tracks: by default, IndexedDB nakarte-web that takes the last session of the old
    // client (database sessions); null means no saves; the browser tests put in their own, so that renders of App on
    // one page do not see the tracks of each other
    autosave?: AutosaveStorage | null;
    // Street View: by default, the Google Maps JavaScript API; the browser tests put in a fake window without the
    // network
    streetView?: StreetViewApi;
    // error toast after the start: main.tsx passes the failed import of moved data (move/move-in.ts). The toast
    // manager has no listener before Toaster mounts, so the toast waits for an effect of App
    notice?: string | null;
}

// The height of the bottom panels is in CSS variables on <html>: the panorama goes above the elevation profile
// (--profile-inset); the profile button, the map attribution and the toasts go above both (--bottom-inset), and the
// top bar with the editor panels (TopBar.tsx) limits its height by it. The variables are on <html>, because Base UI
// renders the toasts into a portal outside <main>
function BottomInset() {
    const profile = useAppStore((state) => state.profile !== null);
    const panorama = useAppStore((state) => state.streetView.enabled && state.streetView.pano !== null);
    useEffect(() => {
        const root = document.documentElement;
        const profileInset = profile ? `(${PROFILE_HEIGHT} + 0.75rem)` : '0px';
        const panoramaInset = panorama ? `(${panoramaHeight(profile)} + 0.75rem)` : '0px';
        root.style.setProperty('--profile-inset', profile ? `calc${profileInset}` : '0px');
        root.style.setProperty('--bottom-inset', `calc(${profileInset} + ${panoramaInset})`);
        return () => {
            root.style.removeProperty('--profile-inset');
            root.style.removeProperty('--bottom-inset');
        };
    }, [profile, panorama]);
    return null;
}

function notify(title: string, type?: 'error' | 'success') {
    toast.add({ title, type });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

export function App({
    transformRequest,
    mapRef,
    fetch = window.fetch.bind(window),
    writeClipboard,
    router,
    autosave,
    streetView,
    notice,
}: AppProps) {
    // Strict Mode runs effects twice in dev: the ref keeps it one toast
    const noticeShown = useRef(false);
    useEffect(() => {
        if (notice && !noticeShown.current) {
            noticeShown.current = true;
            notify(notice, 'error');
        }
    }, [notice]);
    const [store] = useState(startStore);
    const [atPosition] = useState(() => startsAtPosition(window.location.hash));
    // whether to fall back from a basemap on an error of its source (layers/basemap-fallback.ts): it remembers which
    // basemaps already showed tiles
    const [fallbackGate] = useState(() => createFallbackGate());
    useEffect(() => {
        if (atPosition) {
            refreshPosition(navigator.geolocation, localStorageOrNull(), (position) =>
                store.getState().requestView({ ...position, zoom: config.defaultZoom }),
            );
        }
    }, [atPosition, store]);
    const [autosaveStorage] = useState(() =>
        autosave === undefined ? { ...indexedDbStorage(), legacy: legacySessionSource() } : autosave,
    );
    const [restored] = useState(deferred);
    const [trackActions] = useState(() =>
        createTrackActions({
            store,
            sources: {
                fetch,
                corsProxyUrl: config.corsProxyUrl,
                tracksStorageServer: config.tracksStorageServer,
                elevationsServer: config.elevationsServer,
            },
            notify,
            location: () => window.location,
            writeClipboard,
            restored: restored.promise,
        }),
    );
    // Autosave is in an effect, not in an initializer: Strict Mode calls the effect two times, and the first instance
    // stops before the read ends, without adding tracks. restored lets in the tracks from the address only after the
    // read of the live instance (design add-web-autosave, «Восстановление и треки из адреса»).
    useEffect(() => {
        if (!autosaveStorage) {
            restored.resolve();
            return;
        }
        let active = true;
        const saving = startAutosave(store, autosaveStorage);
        saving.restored.finally(() => {
            if (active) {
                restored.resolve();
            }
        });
        const flush = () => saving.flush();
        const onHidden = () => {
            if (document.visibilityState === 'hidden') {
                saving.flush();
            }
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onHidden);
        return () => {
            active = false;
            // an unmount is like leaving the page: the code writes the unsaved changes (this is how the browser tests
            // "reload" App)
            saving.flush();
            saving.stop();
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onHidden);
        };
    }, [store, autosaveStorage, restored]);
    const [routeEditing] = useState(() =>
        createRouteEditing({
            store,
            router:
                router ??
                createRouter({
                    engine: config.routingEngine,
                    routingServer: config.routingServer,
                    fetch,
                    getEngine,
                }),
            engine: config.routingEngine,
            notify,
            storage: localStorageOrNull(),
        }),
    );
    const [streetViewMode] = useState(() =>
        createStreetView({ store, api: streetView ?? googleStreetView(config.googleMapsApiKey), notify }),
    );
    const [elevationProfile] = useState(() =>
        createElevationProfile({ store, source: { fetch, url: config.elevationsServer }, notify }),
    );
    useEffect(() => elevationProfile.start(), [elevationProfile]);
    useEffect(
        () => bindAppStore(store, window, localStorageOrNull(), trackActions.openTrackParams),
        [store, trackActions],
    );
    // if an activity is already selected, the engine warms up at the page load (spec browser-routing-engine); the
    // engine is a singleton, so a second call in Strict Mode does not create it again
    useEffect(() => routeEditing.warmUp(), [routeEditing]);

    function showTileError(code: string, status: number | undefined, tile: boolean) {
        // a basemap with a fallback (OpenFreeMap Outdoor without an SLA, Tracestrack Topo without a key or quota) would
        // leave a gray background on a failure, so instead of an error toast the code falls back to the next one in
        // the chain Of → Tt → O (spec map-layers, «Откат подложки при ошибке тайлов»). fallbackGate decides when to
        // fall back: a single network failure of a basemap that already showed tiles does not make it fall back. The
        // code silently discards the errors of its tiles that come after the basemap change
        const next = BASEMAP_FALLBACKS[code];
        if (next) {
            if (fallbackGate.shouldFallBack(code, { status, tile }) && store.getState().fallBackBase(code)) {
                const { layers } = store.getState();
                toast.add({
                    id: `basemap-fallback:${code}`,
                    title: `${layers.get(code)?.title ?? code} is unavailable`,
                    description: `Switched to ${layers.get(next)?.title ?? next}`,
                    type: 'error',
                });
            }
            return;
        }
        // 404 means "no tile" for regional and sparse layers (Slazav inside its area), and it is not an error
        if (status === 404) {
            return;
        }
        // for an empty tile of a date (no imagery of the tile on that day), GIBS answers sometimes with a transparent
        // PNG and sometimes with 500, mixed (checked with curl on 2026-10-12, design add-dated-imagery): a toast for
        // each such tile would be false. An empty layer is visible without a toast
        if (store.getState().layers.get(code)?.dated) {
            return;
        }
        // a constant id per layer: Base UI updates a toast with the same id in place, so a series of errors gives one
        // toast
        toast.add({
            id: `tile-error:${code}`,
            title: 'Map tiles failed to load',
            description: code === COVERAGE_CODE ? COVERAGE_TITLE : (store.getState().layers.get(code)?.title ?? code),
            type: 'error',
        });
    }

    return (
        <AppStoreContext value={store}>
            <TrackActionsContext value={trackActions}>
                <RouteEditingContext value={routeEditing}>
                    <ElevationProfileContext value={elevationProfile}>
                        <StreetViewContext value={streetViewMode}>
                            <BottomInset />
                            <Toaster>
                                <main
                                    className="fixed inset-0 overflow-hidden"
                                    // the user can drop track files on the map (onFileDragDrop of the old client)
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        if (event.dataTransfer.files.length) {
                                            trackActions.openFiles([...event.dataTransfer.files]);
                                        }
                                    }}
                                >
                                    <BaseMap
                                        onTileError={showTileError}
                                        onTileLoad={fallbackGate.tileLoaded}
                                        transformRequest={transformRequest}
                                        ref={mapRef}
                                    >
                                        {/* before MapButtons: the controls on the right go in the mount order
                                            (control-portal.tsx) */}
                                        <LayerSwitcher />
                                        <MapButtons notify={notify} storage={localStorageOrNull()} />
                                    </BaseMap>
                                    <TopBar fetch={fetch} />
                                    <MapActions fetch={fetch} />
                                    <ElevationProfile />
                                    <StreetViewPanel />
                                    <MapMenu />
                                    <PointNameDialog />
                                    <CopyFallbackDialog />
                                </main>
                            </Toaster>
                        </StreetViewContext>
                    </ElevationProfileContext>
                </RouteEditingContext>
            </TrackActionsContext>
        </AppStoreContext>
    );
}
