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
        // доступ к хранилищу запрещён (настройки сайта): приложение работает на умолчаниях
        return null;
    }
}

// Заход без вида и без треков в адресе — на последнем положении пользователя (moveMapToCurrentLocation старого клиента)
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
    // сеть треков (хранилище, прокси) и буфер обмена: browser-тесты подставляют свои, в сеть они не ходят
    fetch?: typeof fetch;
    writeClipboard?: TrackActionsDeps['writeClipboard'];
    // роутер прокладки: browser-тесты подставляют поддельный, по умолчанию — движок или сервер из config
    router?: Router;
    // хранилище автосохранения треков: по умолчанию IndexedDB nakarte-web с подхватом последней сессии старого клиента
    // (база sessions), null — без сохранения; browser-тесты подставляют своё, чтобы рендеры App в одной странице не видели
    // чужих треков
    autosave?: AutosaveStorage | null;
    // Street View: по умолчанию Maps JavaScript API Google; browser-тесты подставляют поддельное окно без сети
    streetView?: StreetViewApi;
    // error toast after the start: main.tsx passes the failed import of moved data (move/move-in.ts). The toast
    // manager has no listener before Toaster mounts, so the toast waits for an effect of App
    notice?: string | null;
}

// Высота нижних панелей — CSS-переменные на <html>: над профилем высот встаёт панорама (--profile-inset), над обеими —
// панели редактора, атрибуция карты и тосты (--bottom-inset), а тосты Base UI рендерятся в портал вне <main>
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
    // откатывать ли подложку по ошибке её источника (layers/basemap-fallback.ts): помнит, какие подложки уже показали тайлы
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
    // Автосохранение — в эффекте, а не в инициализаторе: Strict Mode вызывает эффект дважды, и первый экземпляр
    // останавливается до конца чтения, не добавив треков. restored отпускает треки из адреса только после чтения
    // живого экземпляра (design add-web-autosave, «Восстановление и треки из адреса»).
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
            // размонтирование — как уход со страницы: несохранённое пишется (browser-тесты так «перезагружают» App)
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
    // активность уже выбрана — движок прогревается при загрузке страницы (спека browser-routing-engine); движок —
    // синглтон, повторный вызов в Strict Mode его не создаёт второй раз
    useEffect(() => routeEditing.warmUp(), [routeEditing]);

    function showTileError(code: string, status: number | undefined, tile: boolean) {
        // подложка с откатом (OpenFreeMap Outdoor без SLA, Tracestrack Topo без ключа или квоты) при сбое оставила бы
        // серый фон — вместо тоста ошибки откат на следующую в цепочке Of → Tt → O (спека map-layers, «Откат подложки при
        // ошибке тайлов»). Когда откатывать, решает fallbackGate: разовый сбой сети уже показанной подложки её не
        // откатывает. Ошибки её тайлов, пришедшие уже после смены подложки, молча отбрасываются
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
        // 404 — «тайла нет» у региональных и разреженных слоёв (Slazav внутри района), это не ошибка
        if (status === 404) {
            return;
        }
        // GIBS на пустой тайл даты (над тайлом в этот день не снимали) то отвечает прозрачным PNG, то 500 — вперемешку,
        // проверено curl 2026-10-12 (design add-dated-imagery): тост на каждый такой тайл был бы ложным. Пустой слой виден и так
        if (store.getState().layers.get(code)?.dated) {
            return;
        }
        // постоянный id на слой: Base UI обновляет тост с тем же id на месте, серия ошибок даёт один тост
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
                                    // файлы треков можно бросить на карту (onFileDragDrop старого клиента)
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
                                        {/* до MapButtons: контролы справа встают в порядке монтирования (control-portal.tsx) */}
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
