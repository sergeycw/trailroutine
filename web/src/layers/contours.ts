import type { AddProtocolAction, RequestTransformFunction, ResourceType } from 'maplibre-gl';
import { TERRARIUM_MAX_ZOOM, TERRARIUM_TILES } from './catalog';

// Contour line tiles (the Ct overlay, design add-contour-lines): the handler of the catalog protocol CONTOUR_PROTOCOL.
// maplibre-contour (BSD-3) loads the Terrarium relief tiles and builds the lines; the app imports the library at the
// first tile, so without the contour lines turned on, its chunk and its worker are not present.

type ContourLib = typeof import('maplibre-contour')['default'];
type DemSource = InstanceType<ContourLib['DemSource']>;

// The step by MapLibre zoom (the m= of the address is 1 more): [intermediate, main], m. A zoom without an entry takes
// the nearest smaller one (GlobalContourTileOptions.thresholds), below the first one there are no lines. The
// calculation is in design add-contour-lines, «Шаг по зуму»
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
    10: [200, 1000],
    11: [100, 500],
    12: [50, 250],
    13: [20, 100],
    14: [10, 50],
};

// the layer and the properties of the vector tile (the library defaults are the same); the style of the lines and the
// labels is in src/layers/style.ts
export const CONTOUR_LAYER = 'contours';
// elevation, m
export const CONTOUR_ELEVATION = 'ele';
// 0 — intermediate, 1 — main: the largest index in the thresholds pair that the elevation is a multiple of
export const CONTOUR_LEVEL = 'level';

// values from the README example of maplibre-contour
const CACHE_SIZE = 100;
const TIMEOUT_MS = 10_000;

// transformRequest is only for browser tests: then the library works on the main thread and gets the relief tiles
// through it, as the map gets the other tiles (src/test/tiles.ts). Without it, the library uses its own Web Worker
// (Blob URL), and its fetch goes past the transformRequest of the map.
export function contourProtocol(transformRequest?: RequestTransformFunction): AddProtocolAction {
    let source: Promise<{ dem: DemSource; query: string }> | undefined;
    return async (request, abortController) => {
        // a failed chunk import is not remembered: the next tile tries again
        source ??= createSource(transformRequest).catch((error: unknown) => {
            source = undefined;
            throw error;
        });
        const { dem, query } = await source;
        // the library handler takes z/x/y from //z/x/y, and the step and the other options from the query string: the
        // library itself builds it (contourProtocolUrl), so this code does not repeat its option format
        return dem.contourProtocolV4({ ...request, url: `${request.url}?${query}` }, abortController);
    };
}

async function createSource(transformRequest: RequestTransformFunction | undefined) {
    const { default: mlcontour } = await import('maplibre-contour');
    const params = {
        encoding: 'terrarium',
        maxzoom: TERRARIUM_MAX_ZOOM,
        cacheSize: CACHE_SIZE,
        timeoutMs: TIMEOUT_MS,
    } as const;
    const dem = new mlcontour.DemSource({ ...params, url: TERRARIUM_TILES, worker: !transformRequest });
    if (transformRequest) {
        // DemSource does not accept a custom getTile, but LocalDemManager does; manager of DemSource is a public field
        dem.manager = new mlcontour.LocalDemManager({
            ...params,
            demUrlPattern: TERRARIUM_TILES,
            getTile: async (url, abortController) => {
                const transformed = (await transformRequest(url, 'Tile' as ResourceType)) ?? { url };
                const response = await fetch(transformed.url, { signal: abortController.signal });
                if (!response.ok) {
                    throw new Error(`Bad response: ${response.status} for ${url}`);
                }
                return { data: await response.blob() };
            },
        });
    }
    const query = dem
        .contourProtocolUrl({
            thresholds: CONTOUR_THRESHOLDS,
            contourLayer: CONTOUR_LAYER,
            elevationKey: CONTOUR_ELEVATION,
            levelKey: CONTOUR_LEVEL,
        })
        .split('?')[1];
    return { dem, query };
}
