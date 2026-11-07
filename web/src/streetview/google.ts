import type { LatLng } from '@/tracks/model';
import type { StreetViewApi, StreetViewHandlers, StreetViewViewer } from './api';
import type { PanoView } from './hash';
import './keyless.css';

// Street View on the Maps JavaScript API (design add-web-search-panoramas, «Maps JavaScript API и ключ»): the google
// provider of the old client (src/lib/leaflet.control.panoramas/lib/google/index.js). A script loads the API one time
// per page and only on demand. The address is as in the old client (v=3&key=), plus the documented callback. An
// empty key means the mode without a key: a class of the window container turns on the rules of keyless.css.

// Our own part of the API types instead of @types/google.maps: the code needs only the classes and methods below
// (Street View reference, 2026-10-09). StreetViewPov has no zoom: the window zoom uses getZoom/setZoom (the old
// client read pov.zoom).
interface GLatLng {
    lat(): number;
    lng(): number;
}

interface GPanorama {
    getPosition(): GLatLng | null;
    setPosition(position: { lat: number; lng: number }): void;
    getPov(): { heading: number; pitch: number };
    setPov(pov: { heading: number; pitch: number }): void;
    getZoom(): number;
    setZoom(zoom: number): void;
    setVisible(visible: boolean): void;
    addListener(event: string, handler: () => void): unknown;
}

interface GMaps {
    StreetViewPanorama: new (container: HTMLElement, options: Record<string, unknown>) => GPanorama;
    StreetViewService: new () => {
        getPanorama(
            request: { location: LatLng; radius: number; preference: unknown },
            callback: (data: { location?: { latLng?: GLatLng } } | null, status: unknown) => void,
        ): unknown;
    };
    StreetViewPreference: { NEAREST: unknown };
    StreetViewStatus: { OK: unknown };
    event: { trigger(target: unknown, event: string): void; clearInstanceListeners(target: unknown): void };
}

// global names of the API: window.google and the load callback
type GoogleWindow = Window & { google?: { maps?: GMaps } } & Record<string, unknown>;

export const GOOGLE_MAPS_API = 'https://maps.googleapis.com/maps/api/js';
const CALLBACK = '__trailroutineGoogleMapsReady';

export function googleMapsUrl(key: string): string {
    return `${GOOGLE_MAPS_API}?v=3&key=${encodeURIComponent(key)}&callback=${CALLBACK}`;
}

export class StreetViewUnavailable extends Error {}

let loading: Promise<GMaps> | null = null;
// a script that does not load and does not fail in this time counts as failed: otherwise the toast never comes
const LOAD_TIMEOUT_MS = 20_000;
// a panorama search without an answer is an API error, not "no panorama"
const SEARCH_TIMEOUT_MS = 10_000;

// One API script per page. A load error resets the promise: the next click tries again.
export function loadGoogleMaps(key: string, doc?: Document, win?: GoogleWindow): Promise<GMaps> {
    const w = win ?? (window as unknown as GoogleWindow);
    if (w.google?.maps?.StreetViewPanorama) {
        return Promise.resolve(w.google.maps);
    }
    const d = doc ?? document;
    if (!loading) {
        loading = new Promise<GMaps>((resolve, reject) => {
            const script = d.createElement('script');
            const timer = setTimeout(() => fail(), LOAD_TIMEOUT_MS);
            const fail = () => {
                clearTimeout(timer);
                loading = null;
                script.remove();
                reject(new StreetViewUnavailable('Maps JavaScript API failed to load'));
            };
            w[CALLBACK] = () => {
                const maps = w.google?.maps;
                if (maps?.StreetViewPanorama) {
                    clearTimeout(timer);
                    resolve(maps);
                } else {
                    fail();
                }
            };
            script.src = googleMapsUrl(key);
            script.async = true;
            script.onerror = fail;
            d.head.append(script);
        });
    }
    return loading;
}

// One Google window per page (as in the old client): the API cannot destroy a StreetViewPanorama, and a new window
// for each turn-on of the mode would collect WebGL scenes (the map shares the browser limit of contexts). The
// window lives in its own div, which moves into the container of the next panel. owner is the panel that owns the
// window now.
interface SharedViewer {
    element: HTMLElement;
    panorama: GPanorama;
    owner: object | null;
    report: (() => void) | null;
}

let shared: SharedViewer | null = null;

// for the loader tests: forget the loaded script and the window
export function resetGoogleMapsLoader() {
    loading = null;
    shared = null;
}

function currentView(panorama: GPanorama): PanoView | null {
    const position = panorama.getPosition();
    if (!position) {
        return null;
    }
    const { heading, pitch } = panorama.getPov();
    return {
        lat: position.lat(),
        lng: position.lng(),
        heading: heading || 0,
        pitch: pitch || 0,
        zoom: panorama.getZoom() || 1,
    };
}

export function googleStreetView(key: string): StreetViewApi {
    const load = () => loadGoogleMaps(key);
    return {
        async findPanorama(at, radius) {
            const maps = await load();
            const service = new maps.StreetViewService();
            return new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new StreetViewUnavailable('Street View search timed out')),
                    SEARCH_TIMEOUT_MS,
                );
                // the form with a callback: it gives the status explicitly, and the reference does not tell what
                // the promise does on ZERO_RESULTS. The code catches the promise rejection to prevent
                // "Uncaught (in promise)"
                const returned = service.getPanorama(
                    { location: at, radius, preference: maps.StreetViewPreference.NEAREST },
                    (data, status) => {
                        clearTimeout(timer);
                        const latLng = data?.location?.latLng;
                        resolve(
                            status === maps.StreetViewStatus.OK && latLng
                                ? { lat: latLng.lat(), lng: latLng.lng() }
                                : null,
                        );
                    },
                );
                (returned as Promise<unknown> | undefined)?.catch?.(() => {});
            });
        },

        async createViewer(container: HTMLElement, { onChange }: StreetViewHandlers): Promise<StreetViewViewer> {
            const maps = await load();
            if (!shared) {
                const element = document.createElement('div');
                element.style.position = 'absolute';
                element.style.inset = '0';
                const panorama = new maps.StreetViewPanorama(element, {
                    enableCloseButton: false,
                    imageDateControl: true,
                    motionTracking: false,
                    motionTrackingControl: false,
                    fullscreenControl: false,
                });
                const viewer: SharedViewer = { element, panorama, owner: null, report: null };
                for (const event of ['position_changed', 'pov_changed', 'zoom_changed']) {
                    panorama.addListener(event, () => viewer.report?.());
                }
                shared = viewer;
            }
            const viewer = shared;
            const owner = {};
            viewer.owner = owner;
            // the rules of the mode without a key apply only with an empty key (markKeylessContainer of the old
            // client); the class is on the direct parent of .gm-style, as in the old client
            viewer.element.classList.toggle('google-street-view-keyless', !key);
            container.append(viewer.element);
            viewer.report = () => {
                const view = currentView(viewer.panorama);
                if (view) {
                    onChange(view);
                }
            };
            const mine = () => viewer.owner === owner;
            return {
                show(view) {
                    if (!mine()) {
                        return;
                    }
                    viewer.panorama.setPosition({ lat: view.lat, lng: view.lng });
                    viewer.panorama.setPov({ heading: view.heading, pitch: view.pitch });
                    viewer.panorama.setZoom(view.zoom);
                    viewer.panorama.setVisible(true);
                },
                resize: () => {
                    if (mine()) {
                        maps.event.trigger(viewer.panorama, 'resize');
                    }
                },
                // the window stays for the next panel: hidden, without a listener, outside the document
                destroy() {
                    if (!mine()) {
                        return;
                    }
                    viewer.owner = null;
                    viewer.report = null;
                    viewer.panorama.setVisible(false);
                    viewer.element.remove();
                },
            };
        },
    };
}
