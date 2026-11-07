import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { CONTOUR_PROTOCOL } from '@/layers/catalog';
import { contourProtocol } from '@/layers/contours';

// MapLibre 6 finds the worker through new URL(<variable>, import.meta.url), and the bundler does not see such a path:
// without setWorkerUrl, the map fails with «Worker failed to load» both in dev and in the build. The method for Vite is
// in the Installation section of the MapLibre documentation (?worker&url). The library loads lazily as a separate
// chunk, react-maplibre accepts the promise through mapLib. The contour line protocol is registered before the first
// map style: MapLibre would give a tile with an unregistered protocol to fetch.
export const maplibre = import('maplibre-gl').then((lib) => {
    lib.setWorkerUrl(workerUrl);
    lib.addProtocol(CONTOUR_PROTOCOL, contourProtocol());
    return lib;
});
