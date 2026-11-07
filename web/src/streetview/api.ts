import type { LatLng } from '@/tracks/model';
import type { PanoView } from './hash';

// Street View behind its own interface (design add-web-search-panoramas, «Модули»): the app does not know about
// Google, and the browser tests and e2e put in their own window without the network (src/test/fake-street-view.ts,
// the API stub in e2e/fixtures.ts).

export interface StreetViewHandlers {
    // the window moved to a different point or turned
    onChange(view: PanoView): void;
}

export interface StreetViewViewer {
    show(view: PanoView): void;
    // the container changed its size
    resize(): void;
    // the window is not necessary any more: remove the listeners and hide the panorama
    destroy(): void;
}

export interface StreetViewApi {
    // the nearest panorama in the radius (meters) or null; an API load error is an exception
    findPanorama(at: LatLng, radius: number): Promise<LatLng | null>;
    createViewer(container: HTMLElement, handlers: StreetViewHandlers): Promise<StreetViewViewer>;
}
