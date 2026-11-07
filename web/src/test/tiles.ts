import type { RequestTransformFunction } from 'maplibre-gl';
import { CONTOUR_PROTOCOL, OPENFREEMAP_TILEJSON } from '@/layers/catalog';
// a real OpenFreeMap tile z12/2554/1509 near Kazbek (planet 20261004_113936_pt, downloaded on 2026-10-12): peaks
// with ele, places with name, name:ru and name:latin. Data © OpenStreetMap contributors (ODbL), schema © OpenMapTiles
import vectorTileFixture from './openfreemap-tile.pbf?url';
import tileFixture from './tile.png?url';

// The network of the map browser tests: the tiles of all layers (raster and DEM; vector .pbf go to their own
// fixture) go to a local fixture, and the code records the requested addresses. A request that is not to localhost
// and is not a tile goes into external, and the test must end with an empty list. So the tests do not use the
// network and find a layer that loads something other than tiles.

export const TILE_FIXTURE_URL = new URL(tileFixture, location.href).href;
const VECTOR_TILE_FIXTURE_URL = new URL(vectorTileFixture, location.href).href;

// The OpenFreeMap TileJSON (basemap Of): the tile address is as in the real one, with the build version, and the
// tiles go to the vector tile fixture. A data: URL, not a file: the Vite dev server serves .json as a module
const OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet/fixture/{z}/{x}/{y}.pbf';
const OPENFREEMAP_TILEJSON_FIXTURE = `data:application/json,${encodeURIComponent(
    JSON.stringify({ tilejson: '3.0.0', tiles: [OPENFREEMAP_TILES], minzoom: 0, maxzoom: 14 }),
)}`;

export interface FixtureTiles {
    transformRequest: RequestTransformFunction;
    // the original addresses of the tiles that the map requested
    requested: string[];
    external: string[];
    // the answer for the tiles with an address that matches the pattern: a given address instead of the fixture
    respond(pattern: RegExp, url: string): void;
}

export function fixtureTiles(): FixtureTiles {
    const overrides: [RegExp, string][] = [];
    const tiles: FixtureTiles = {
        requested: [],
        external: [],
        respond: (pattern, url) => {
            overrides.push([pattern, url]);
        },
        transformRequest: (url, resourceType) => {
            // the contour protocol is not the network: renderApp sets its handler, which gets the terrain tiles through
            // this same transformRequest (src/layers/contours.ts)
            const { hostname, protocol } = new URL(url);
            if (hostname === location.hostname || protocol === `${CONTOUR_PROTOCOL}:`) {
                return { url };
            }
            // the tile description of the vector basemap is not a tile and not a leak: the code records it with
            // the tiles
            if (url === OPENFREEMAP_TILEJSON) {
                tiles.requested.push(url);
                // respond also replaces the tile description: so a test makes all of OpenFreeMap fail (fallback
                // Of → Tt)
                const override = overrides.find(([pattern]) => pattern.test(url));
                return { url: override ? override[1] : OPENFREEMAP_TILEJSON_FIXTURE };
            }
            if (resourceType !== 'Tile') {
                tiles.external.push(url);
                return { url: 'about:blank' };
            }
            tiles.requested.push(url);
            const override = overrides.find(([pattern]) => pattern.test(url));
            if (override) {
                return { url: override[1] };
            }
            return { url: url.endsWith('.pbf') ? VECTOR_TILE_FIXTURE_URL : TILE_FIXTURE_URL };
        },
    };
    return tiles;
}
