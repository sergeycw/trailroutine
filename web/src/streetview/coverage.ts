// The Street View coverage is Google tiles without a key (getCoverageLayer of the old client,
// src/lib/leaflet.control.panoramas/lib/google/index.js): 256 px, CORS * (checked with curl on 2026-10-09). The
// module has no imports: the e2e network fixture also reads it (e2e builds as a Node module).

export const COVERAGE_CODE = 'street-view-coverage';
export const COVERAGE_TITLE = 'Street View coverage';
export const COVERAGE_TILES =
    'https://maps.googleapis.com/maps/vt?pb=!1m5!1m4!1i{z}!2i{x}!3i{y}!4i256!2m8!1e2!2ssvv!4m2!1scb_client!2sapiv3!4m2!1scc!2s*211m3*211e3*212b1*213e2*211m3*211e2*212b1*213e2!3m5!3sUS!12m1!1e40!12m1!1e18!4e0';

// The coverage layer as a catalog layer: above the basemap and the overlays (the last in the order), below the
// profile, the tracks and the editor. Tile errors go to the common toast with this title. The type is structural,
// without an import of the catalog (see the header).
export const COVERAGE_LAYER = {
    code: COVERAGE_CODE,
    title: COVERAGE_TITLE,
    group: '',
    order: Number.MAX_SAFE_INTEGER,
    isOverlay: true,
    isDefault: false,
    source: { type: 'raster' as const, tiles: [COVERAGE_TILES], tileSize: 256, maxzoom: 21 },
};
