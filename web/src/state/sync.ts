import type { LayerDef } from '@/layers/catalog';
import { DATE_PARAM, parseDateParam } from '@/layers/dated';
import { formatLayersParam, parseLayersParam } from '@/layers/selection';
import { loadSettings, saveSettings } from '@/layers/settings';
import { loadActivity } from '@/routing/activity';
import { loadHikingOptions } from '@/routing/options';
import { formatPlacemark, PLACEMARK_PARAM, type Placemark, parsePlacemark } from '@/search/placemark';
import {
    formatStreetView,
    LEGACY_STREET_VIEW_PARAM,
    parseStreetView,
    STREET_VIEW_PARAM,
    type StreetViewHash,
} from '@/streetview/hash';
import { isTrackParam, type TrackParam } from '@/tracks/links';
import { formatHash, formatView, parseHash, parseView, type View, withParam } from './hash';
import { type AppStore, createAppStore, savedSelection } from './store';

// The store connection to the address and localStorage (design add-web-map-layers, «Адрес»). At start: address →
// localStorage → defaults. Then the store writes m= and the panorama to n2= (at most once in 300 ms: moveend and the
// view direction come in series), and l=, r= of the search placemark and the Street View mode in n2= (immediately)
// through history.replaceState: it does not send hashchange, so there is no loop; hashchange (the user edits the
// address) moves the map and switches the layers. Track parameters (nktk, nktl, nktu, nktp, nktj) are read at start and
// on hashchange and immediately removed from the address, as bindHashStateReadOnly of the old client does; App loads
// them (design add-web-tracks, «Стор»).

export interface AddressWindow {
    location: { hash: string; pathname: string; search: string };
    history: { replaceState(data: unknown, unused: string, url: string): void };
    addEventListener(type: 'hashchange', listener: () => void): void;
    removeEventListener(type: 'hashchange', listener: () => void): void;
}

export interface StartOptions {
    catalog: readonly LayerDef[];
    corsProxyUrl: string;
    defaultView: View;
    hash: string;
    storage: Storage | null;
}

export function startAppStore({ catalog, corsProxyUrl, defaultView, hash, storage }: StartOptions): AppStore {
    const params = parseHash(hash);
    const settings = loadSettings(storage, catalog);
    const store = createAppStore({
        catalog,
        corsProxyUrl,
        settings,
        // the last selection only if the address does not give a valid l= (below)
        selection: settings.selection ?? { base: '', overlays: [] },
        view: parseView(params.get('m')) ?? defaultView,
        imageryDate: parseDateParam(params.get(DATE_PARAM)),
        routingActivity: loadActivity(storage),
        hikingOptions: loadHikingOptions(storage),
        placemark: parsePlacemark(params.get(PLACEMARK_PARAM)),
        streetView: parseStreetView(params.get(STREET_VIEW_PARAM), params.get(LEGACY_STREET_VIEW_PARAM)),
    });
    const parsed = parseLayersParam(params.get('l'), new Map(catalog.map((layer) => [layer.code, layer])));
    // An l= that matches the saved selection is our own address from the last visit (the app always writes l=), not a
    // link: it does not add layers to the list and does not overwrite the column memory. Otherwise a reload would bring
    // back a check mark that the user cleared for a layer on the map, and the group memory would change to the last
    // layer in the l= order (design quick-layer-menus, design custom-bases-in-list)
    const { selection, layers } = store.getState();
    const own =
        settings.selection !== null && params.get('l')?.join('/') === formatLayersParam(selection, layers).join('/');
    if (parsed && !own) {
        store.getState().applyLayersParam(parsed);
    }
    return store;
}

const VIEW_DEBOUNCE_MS = 300;

const streetViewParam = (state: StreetViewHash) => formatStreetView(state)?.join('/') ?? null;

// placemarks are compared by their form in the address: the same placemark from the address is not created again
function samePlacemark(a: Placemark | null, b: Placemark | null): boolean {
    return (a && formatPlacemark(a).join('/')) === (b && formatPlacemark(b).join('/'));
}

export type TrackParams = [key: TrackParam, values: string[]][];

// fitView: at start, the address had no valid m=: the map shows the loaded tracks in full
export type TrackParamsHandler = (params: TrackParams, fitView: boolean) => void;

export function bindAppStore(
    store: AppStore,
    win: AddressWindow,
    storage: Storage | null,
    onTrackParams: TrackParamsHandler = () => {},
): () => void {
    let viewTimer: ReturnType<typeof setTimeout> | undefined;

    // track parameters from the address, and immediately out of it; empty ones (`nktk` without `=`) are removed too
    function takeTrackParams(): TrackParams {
        let params = parseHash(win.location.hash);
        const found: TrackParams = [];
        let removed = false;
        for (const [key, values] of params) {
            if (isTrackParam(key)) {
                params = withParam(params, key, null);
                removed = true;
                if (values.length) {
                    found.push([key, [...values]]);
                }
            }
        }
        if (removed) {
            win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}#${formatHash(params)}`);
        }
        return found;
    }

    // l= has the user selection, not the fallback basemap (design add-outdoor-basemap): a reload tries the selected
    // basemap again (by default OpenFreeMap Outdoor), and a link from the address bar gives the selection, not a
    // temporary replacement
    function layersParam() {
        const state = store.getState();
        return formatLayersParam(savedSelection(state), state.layers);
    }

    // d= only while the basemap is dated imagery (design add-dated-imagery): for other basemaps a date means nothing
    function dateParam() {
        const state = store.getState();
        const base = state.layers.get(savedSelection(state).base);
        return base?.dated && state.imageryDate ? [state.imageryDate] : null;
    }

    function writeAddress() {
        clearTimeout(viewTimer);
        viewTimer = undefined;
        let params = parseHash(win.location.hash);
        params = withParam(params, 'm', formatView(store.getState().view));
        params = withParam(params, 'l', layersParam());
        params = withParam(params, DATE_PARAM, dateParam());
        const { placemark } = store.getState();
        params = withParam(params, PLACEMARK_PARAM, placemark ? formatPlacemark(placemark) : null);
        // the old n= is replaced with n2= after the read (hashStateUpgrader of the old client)
        params = withParam(params, LEGACY_STREET_VIEW_PARAM, null);
        params = withParam(params, STREET_VIEW_PARAM, formatStreetView(store.getState().streetView));
        const hash = formatHash(params);
        if (hash !== win.location.hash.replace(/^#/u, '')) {
            win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}#${hash}`);
        }
    }

    function persist() {
        const state = store.getState();
        saveSettings(storage, { ...state.settings, selection: savedSelection(state) });
    }

    function onHashChange() {
        const trackParams = takeTrackParams();
        const params = parseHash(win.location.hash);
        const state = store.getState();
        const view = parseView(params.get('m'));
        if (view && formatView(view).join('/') !== formatView(state.view).join('/')) {
            state.requestView(view);
        }
        const parsed = parseLayersParam(params.get('l'), new Map(state.catalog.map((layer) => [layer.code, layer])));
        if (parsed && params.get('l')?.join('/') !== layersParam().join('/')) {
            state.applyLayersParam(parsed);
        }
        // an address without d= keeps the current date: writeAddress below puts it back into the address
        const date = parseDateParam(params.get(DATE_PARAM));
        if (date && date !== state.imageryDate) {
            state.setImageryDate(date);
        }
        const placemark = parsePlacemark(params.get(PLACEMARK_PARAM));
        if (!samePlacemark(placemark, state.placemark)) {
            state.setPlacemark(placemark);
        }
        const streetView = parseStreetView(params.get(STREET_VIEW_PARAM), params.get(LEGACY_STREET_VIEW_PARAM));
        if (streetViewParam(streetView) !== streetViewParam(state.streetView)) {
            state.setStreetViewEnabled(streetView.enabled);
            if (streetView.pano) {
                state.requestPano(streetView.pano);
            } else {
                state.setPano(null);
            }
        }
        // an address without m= or l= (or with invalid ones): put the current state back into it
        writeAddress();
        if (trackParams.length) {
            onTrackParams(trackParams, false);
        }
    }

    const unsubscribe = store.subscribe((state, prev) => {
        if (
            state.selection !== prev.selection ||
            state.layers !== prev.layers ||
            state.basemapFallback !== prev.basemapFallback
        ) {
            writeAddress();
            persist();
        } else if (state.settings !== prev.settings) {
            persist();
        }
        const sv = state.streetView;
        const prevSv = prev.streetView;
        // placemark, mode, panorama open and close, a move on click: immediately
        if (
            state.imageryDate !== prev.imageryDate ||
            state.placemark !== prev.placemark ||
            sv.enabled !== prevSv.enabled ||
            (sv.pano === null) !== (prevSv.pano === null) ||
            sv.request !== prevSv.request
        ) {
            writeAddress();
        }
        // the panorama view direction changes in series, as the map view does: not more often than once in 300 ms
        if (sv.pano !== prevSv.pano && viewTimer === undefined) {
            viewTimer = setTimeout(writeAddress, VIEW_DEBOUNCE_MS);
        }
        if (state.view !== prev.view && viewTimer === undefined) {
            viewTimer = setTimeout(writeAddress, VIEW_DEBOUNCE_MS);
        }
    });
    win.addEventListener('hashchange', onHashChange);
    const fitView = parseView(parseHash(win.location.hash).get('m')) === null;
    const trackParams = takeTrackParams();
    // the old client writes m= and l= to the address immediately: so a link from the address bar is always complete
    writeAddress();
    persist();
    if (trackParams.length) {
        onTrackParams(trackParams, fitView);
    }

    return () => {
        clearTimeout(viewTimer);
        unsubscribe();
        win.removeEventListener('hashchange', onHashChange);
    };
}
