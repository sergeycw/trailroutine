import type { AppStore } from '@/state/store';
import type { LatLng } from '@/tracks/model';
import type { StreetViewApi } from './api';

// The Street View mode without React (design add-web-search-panoramas, «Street View: режим, клик, окно»): the
// panorama search on a map click, stale answers, the API error. The components draw the window and the marker
// from the store.

export const UNAVAILABLE_MESSAGE = 'Street View is unavailable';

export interface StreetViewDeps {
    store: AppStore;
    api: StreetViewApi;
    notify: (title: string, type?: 'error') => void;
}

export type StreetView = ReturnType<typeof createStreetView>;

export function createStreetView({ store, api, notify }: StreetViewDeps) {
    // the search number: the code discards an answer that comes after a new click, after turn-off or after close
    let seq = 0;
    const state = () => store.getState();

    return {
        api,
        notify,
        toggle() {
            seq += 1;
            state().setStreetViewEnabled(!state().streetView.enabled);
        },
        close() {
            seq += 1;
            state().setPano(null);
        },
        // the nearest panorama in the radius; if found, the window goes there with the same view (showPano of the old
        // client: heading of the window, pitch 0, zoom 1)
        async searchAt(at: LatLng, radius: number) {
            if (!state().streetView.enabled) {
                return;
            }
            seq += 1;
            const current = seq;
            let found: LatLng | null;
            try {
                found = await api.findPanorama(at, radius);
            } catch {
                if (current === seq) {
                    notify(UNAVAILABLE_MESSAGE, 'error');
                }
                return;
            }
            if (current !== seq || !found || !state().streetView.enabled) {
                return;
            }
            state().requestPano({ ...found, heading: state().streetView.pano?.heading ?? 0, pitch: 0, zoom: 1 });
        },
    };
}
