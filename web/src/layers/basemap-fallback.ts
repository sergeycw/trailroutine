// Whether to fall back from a basemap with a fallback (BASEMAP_FALLBACKS in selection.ts) on an error of its source
// (spec map-layers, «Откат подложки при ошибке тайлов»; design openfreemap-default-basemap). The first version fell
// back on the first tile error, and the diff review found this: a phone changed from Wi-Fi to LTE, the requests in
// flight failed with status 0 (AJAXError of MapLibre), and the chain Of → Tt → O went to the end. This spent the
// Tracestrack quota and the OSM traffic without any failure of the service. So a fallback at once happens only for what
// means "no service"; a single failure of a basemap that is already shown causes a fallback only if it repeats.

export interface SourceError {
    // the server answer; undefined or 0 — no answer (network, CORS, broken connection)
    status: number | undefined;
    // a tile error; false — an error of the source itself (the TileJSON tile description of Of)
    tile: boolean;
}

// access refused: no key, quota, limit, the service is off — a retry does not help
const REFUSED = new Set([401, 403, 429, 503]);
// a single failure becomes a fallback if it repeats COUNT times within WINDOW_MS and lasts at least SPREAD_MS: a
// network break or a network change drops the requests in flight in one batch, and a service that is down answers with
// an error for the next tiles too
const COUNT = 3;
const SPREAD_MS = 5_000;
const WINDOW_MS = 60_000;

export interface FallbackGate {
    // a basemap tile loaded: after that, its single failures do not cause a fallback
    tileLoaded(code: string): void;
    shouldFallBack(code: string, error: SourceError): boolean;
}

// now and online are parameters for the unit tests (Node has no navigator)
export function createFallbackGate(
    now: () => number = Date.now,
    online: () => boolean = () => navigator.onLine,
): FallbackGate {
    const loaded = new Set<string>();
    const failures = new Map<string, number[]>();
    return {
        tileLoaded: (code) => {
            loaded.add(code);
        },
        shouldFallBack: (code, { status, tile }) => {
            // the tile description did not load: there is no source, also on 404 (a closed or renamed address)
            if (!tile) {
                return true;
            }
            // a tile 404 means "no tile" in the coverage (the Tracestrack raster); MapLibre itself treats a vector 404
            // as an empty tile
            if (status === 404) {
                return false;
            }
            if (status !== undefined && REFUSED.has(status)) {
                return true;
            }
            if (!online()) {
                return false;
            }
            // no basemap tile has loaded yet: the map is empty, so there is no reason to wait for retries
            if (!loaded.has(code)) {
                return true;
            }
            const at = now();
            const recent = (failures.get(code) ?? []).filter((time) => at - time <= WINDOW_MS);
            recent.push(at);
            failures.set(code, recent);
            return recent.length >= COUNT && at - recent[0] >= SPREAD_MS;
        },
    };
}
