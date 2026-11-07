import type { RasterDEMSourceSpecification, RasterSourceSpecification, VectorSourceSpecification } from 'maplibre-gl';

// The catalog of raster layers of the new app: the data of the old src/layers.js, converted to MapLibre sources
// (design add-web-map-layers, «Каталог»). No Yandex (Y, S: EPSG:3395), Wikimapia (W) and the Ng grid: owner decisions
// (record-new-ui-decisions). The module has no app imports: e2e (Node) imports it too, to know which tiles to replace
// with the fixture.
//
// Conversion of the Leaflet options: the MapLibre map zoom is 1 less than the Leaflet zoom, the tile numbers are the
// same. So maxNativeZoom goes to the source maxzoom as is (without it, 18: the old map did not go above maxZoom 18),
// and the layer minZoom goes to minZoom - 1. cutline is dropped, the bounds rectangle stays.

export type LayerSource = RasterSourceSpecification | RasterDEMSourceSpecification | VectorSourceSpecification;

// AWS Terrain Tiles (Terrarium): the replica elevation-tiles-prod-eu answers 403 to the public, the tiles go up to z15.
// One address for the hillshade (MapLibre) and for the contour lines (maplibre-contour loads the tiles itself,
// src/layers/contours.ts)
export const TERRARIUM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRARIUM_MAX_ZOOM = 15;

// An own MapLibre protocol serves the vector tiles of the contour lines (src/layers/contours.ts, registration in
// src/map/maplibre.ts): here is only the address, so the catalog stays data without a library import (design
// add-contour-lines)
export const CONTOUR_PROTOCOL = 'trailroutine-contours';
export const CONTOUR_MIN_ZOOM = 10;

// Dated imagery (design add-dated-imagery): the token in the tile templates and in the attribution of a layer with
// dated; withDate (src/layers/dated.ts) substitutes it. MapLibre does not know such tokens: a layer without the
// substitution does not go into the style (BaseMap)
export const DATE_TOKEN = '{date}';
export const YEAR_TOKEN = '{year}';

export interface LayerDef {
    // the code in l= and in leafletLayersSettings is the same as in the old client
    code: string;
    title: string;
    group: string;
    // the stacking order from bottom to top (titlesByOrder of the old client)
    order: number;
    isOverlay: boolean;
    // show in the switcher without user settings (isDefault of the old client)
    isDefault: boolean;
    source: LayerSource;
    // the MapLibre map zoom from which the layer is visible
    minZoom?: number;
    opacity?: number;
    // the vector basemap (OpenFreeMap Outdoor): the label language is navigator.language; outdoorLayers
    // (src/layers/outdoor.ts) builds the style in style.ts, which does not have the catalog environment
    labelLanguage?: string;
    // dated imagery: source.tiles has one template with DATE_TOKEN for each GIBS layer from bottom to top; style.ts
    // draws each one as its own source and does not alternate them by tile, as subdomains
    dated?: boolean;
}

export interface CatalogEnv {
    // > 1 — retina variants of the tiles, as L.Browser.retina for RetinaTileLayer
    pixelRatio: number;
    // the Google label language (hl=), as navigator.language for leaflet.layer.google
    language: string;
    corsProxyUrl: string;
}

// The proxy address format is urlViaCorsProxy of the old client: <proxy>https/host/path
export function viaCorsProxy(corsProxyUrl: string, url: string): string {
    return corsProxyUrl + url.replace(/^(https?):\/\//u, '$1/');
}

// {s} of Leaflet → an array of addresses: MapLibre itself selects the address by (x + y) % length
function subdomains(template: string, letters = 'abc'): string[] {
    return [...letters].map((s) => template.replace('{s}', s));
}

const DEFAULT_MAX_ZOOM = 18;

export const GROUPS = [
    'Default layers',
    'OpenStreetMap alternatives',
    'Topo maps',
    'Miscellaneous',
    'Routes and traces',
    'Norway',
] as const;

// titlesByOrder of the old client; the places of custom layers are CUSTOM_BOTTOM and CUSTOM_TOP. The hillshade is above
// the opaque map overlays and under the line overlays, so the shadows fall on any basemap and do not cover the trails.
// Only Configure layers shows the basemap order: the full list does not have them, the circles and the menus follow
// the groups of quick-layers.ts (design custom-bases-in-list). Tt, Of, O, E are first since the owner decision of
// 2026-10-12 (design add-vector-outdoor-style)
const ORDER = [
    'Tt',
    'Of',
    'O',
    'E',
    'S2',
    'Hls',
    'Co',
    'Otm',
    'Ocm',
    'Oso',
    'L',
    'I',
    'G',
    'P',
    '#custom-bottom',
    'Nr',
    'Np',
    'Nm',
    'Fmk',
    'Se',
    'St',
    'Sp',
    'Mt',
    'Q',
    'Gbt',
    'Si',
    'Z',
    '#custom-top',
    'Hs',
    'Ct',
    'Gh',
    'Wh',
    'Wc',
    'Ot',
    'Sa',
    'Sr',
    'Sb',
    'Sw',
];

export const CUSTOM_BOTTOM_ORDER = ORDER.indexOf('#custom-bottom') + 1;
export const CUSTOM_TOP_ORDER = ORDER.indexOf('#custom-top') + 1;

const OSM_ATTRIBUTION = '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap contributors</a>';
// The Topo attribution is word for word from the Tracestrack terms, section 5
// (https://www.tracestrack.com/terms-of-service/, checked 2026-10-10, design map-chrome): the tiles are under CC BY
// 4.0, the attribution is mandatory
const TRACESTRACK_ATTRIBUTION = `Data: ${OSM_ATTRIBUTION}, SRTM, GEBCO, SONNY's LiDAR DTM, NASADEM, ESA WorldCover; <a href="https://www.tracestrack.com/">Maps &copy; Tracestrack</a>`;
// OpenFreeMap (design add-vector-outdoor-style): TileJSON, not a tile template. The tile address has the build version
// of the planet, which changes, and a path without the version gives an empty tile (checked 2026-10-12). The
// attribution is from TileJSON without target, in the source: MapLibre puts the explicit source options above the
// TileJSON fields
export const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
const OPENFREEMAP_ATTRIBUTION =
    '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">&copy; OpenMapTiles</a> ' +
    'Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const STRAVA_ATTRIBUTION = '<a href="https://www.strava.com/heatmap">Strava Global Heatmap</a>';
const KARTVERKET_ATTRIBUTION = '<a href="https://kartverket.no/til-lands/kart/turkart">Kartverket</a>';
const GOOGLE_ATTRIBUTION = '<a href="https://www.google.com/maps">Google</a>';
const GOOGLE_SAT_ATTRIBUTION =
    '<a href="https://www.google.com/maps/@43.0668619,60.5738071,13622628m/data=!3m1!1e3">Google</a>';
// The year of the EOX Sentinel-2 cloudless mosaic (design add-sentinel-imagery): both the WMTS layer and the year in
// the attribution come from it. A new year appears in https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml as the
// layer s2cloudless-<year>_3857 (backlog, «Сопровождение»); s2cloudless_3857 without a year is the 2016 mosaic, not
// the latest one
const SENTINEL_YEAR = 2025;
// The attribution is word for word from the EOX terms (https://cloudless.eox.at/documentation/license, checked
// 2026-10-11): the address shows as text and is also the link (license-non-commercial: «include the links and show the
// text»); the license for 2018+ is CC BY-NC-SA 4.0, non-commercial use only
const SENTINEL_ATTRIBUTION =
    'EOxCloudless <a href="https://cloudless.eox.at">https://cloudless.eox.at</a> by EOX IT Services GmbH ' +
    `(Contains modified Copernicus Sentinel data ${SENTINEL_YEAR}), ` +
    '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/">CC BY-NC-SA 4.0</a>';
// HLS from NASA GIBS (design add-dated-imagery, «Подпись с годом даты»), checked 2026-10-12: the GIBS acknowledgment
// is word for word from Data Use Guidance (https://nasa-gibs.github.io/gibs-api-docs/), Copernicus is «Contains
// modified Copernicus Sentinel data [year]» (https://ads.atmosphere.copernicus.eu/licences/ec-sentinel), USGS is the
// form «… courtesy of the U.S. Geological Survey» (https://www.usgs.gov/centers/eros/data-citation). The year is the
// year of the image date
const HLS_ATTRIBUTION =
    'We acknowledge the use of imagery provided by services from ' +
    '<a href="https://nasa-gibs.github.io/gibs-api-docs/">NASA\'s Global Imagery Browse Services (GIBS)</a>, ' +
    "part of NASA's Earth Science Data and Information System (ESDIS); " +
    '<a href="https://www.earthdata.nasa.gov/data/projects/hls">HLS</a>: ' +
    `contains modified Copernicus Sentinel data ${YEAR_TOKEN}, Landsat image courtesy of the U.S. Geological Survey`;
// GIBS layers from bottom to top: Landsat 8/9 (L30) and Sentinel-2 (S30), both 30 m. The matrix
// GoogleMapsCompatible_Level12 has 256 px tiles up to z12, and GIBS answers 400 for z13; the order {y}/{x} is
// TileRow/TileCol of the template from WMTSCapabilities
// (https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml)
const HLS_LAYERS = ['HLS_L30_Nadir_BRDF_Adjusted_Reflectance', 'HLS_S30_Nadir_BRDF_Adjusted_Reflectance'];
const HLS_MAX_ZOOM = 12;
const SLAZAV_ATTRIBUTION = '<a href="http://slazav.xyz/maps">Vladislav Zavjalov</a>';
// The full list of DEM sources (11 items) is behind the link: joerd/docs/attribution.md requires the attribution "in a
// place that is reasonable for the medium", and the OSMF rules that it refers to allow a link to a page with the full
// attribution.
const TERRAIN_ATTRIBUTION =
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Terrain: Mapzen, sources</a>';

// [west, south, east, north]; the values are the bounds of the old catalog ([[south, west], [north, east]])
const NORWAY_BOUNDS: [number, number, number, number] = [4.19674, 57.81324, 31.56094, 71.27961];

type Def = Omit<LayerDef, 'order'>;

function raster(
    tiles: string[],
    attribution: string,
    options: Omit<RasterSourceSpecification, 'type' | 'tiles' | 'attribution'> = {},
): RasterSourceSpecification {
    return { type: 'raster', tiles, tileSize: 256, maxzoom: DEFAULT_MAX_ZOOM, attribution, ...options };
}

// The label languages of the Tracestrack raster are the map names from the documentation
// (https://tracestrack.com/docs/, checked 2026-10-12), with the prefix topo_ for the topo style. The same list is in
// TILE_PATH of the proxy (workers/cors-proxy/src/tracestrack.js): the key is spent only on these addresses. Edit both
// lists together
export const TRACESTRACK_LANGUAGES = [
    'ar',
    'de',
    'en',
    'es',
    'fi',
    'fr',
    'hu',
    'he',
    'it',
    'ja',
    'ko',
    'nl',
    'uk',
    'pl',
    'pt',
    'ru',
    'th',
    'sv',
    'tr',
    'zh-hans',
    'zh-hant',
];

// Labels in the browser language, or in English without it (owner decision 2026-10-12, design tracestrack-labels): in
// Georgia, the local names are in the Georgian script. The language is in the address, not auto-en of Tracestrack by
// Accept-Language: the browser cache and the proxy cache keep a tile by its address, and the language of one user
// would go to another user
export function tracestrackMap(language: string): string {
    const [primary, ...rest] = language.toLowerCase().split('-');
    let code = primary;
    if (primary === 'zh') {
        // Chinese: traditional script for Taiwan, Hong Kong, Macao or an explicit Hant, otherwise simplified script
        code = rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-hant' : 'zh-hans';
    }
    return `topo_${TRACESTRACK_LANGUAGES.includes(code) ? code : 'en'}`;
}

function googleTiles(lyrs: string, language: string) {
    // Google with z={z} gives the same tiles as the old zoom={17 - z} (checked byte by byte 2026-10-08), so the
    // MapLibre tokens are enough without transformRequest
    return subdomains(
        `https://mt{s}.google.com/vt/lyrs=${lyrs}&hl=${encodeURIComponent(language)}&x={x}&y={y}&z={z}`,
        '0123',
    );
}

function stravaLayer(code: string, kind: string, title: string, env: CatalogEnv): Def {
    // retina: a 512 px tile in 256 CSS px and one zoom less, as retinaOptionsOverrides of the old layer
    const hiRes = env.pixelRatio > 1;
    const url = `https://content-a.strava.com/identified/globalheat/${kind}/hot/{z}/{x}/{y}.png?px=${hiRes ? 512 : 256}`;
    return {
        code,
        title,
        group: 'Routes and traces',
        isOverlay: true,
        // heatmaps are only a column button with a menu (design custom-bases-in-list), and their check boxes in the
        // list are on by default anyway (listedByDefault). isDefault of "all" keeps the group Routes and traces in the
        // Overlays section of the list (overlaySections in LayerSwitcher.tsx); the old client has isDefault: false for
        // all four
        isDefault: code === 'Sa',
        opacity: 0.75,
        source: raster([viaCorsProxy(env.corsProxyUrl, url)], STRAVA_ATTRIBUTION, { maxzoom: hiRes ? 15 : 16 }),
    };
}

function definitions(env: CatalogEnv): Def[] {
    return [
        {
            code: 'Tt',
            title: 'Tracestrack Topo',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            // the default basemap (design add-outdoor-basemap). Only through the proxy: the API key is a secret of the
            // proxy Worker, the client address does not have it (workers/cors-proxy/src/tracestrack.js). The address
            // and maxZoom 19 are as in the openstreetmap.org layer; the label language is tracestrackMap; {ratio} is
            // @2x on screens from 2x, with the same quota credit
            source: raster(
                [
                    viaCorsProxy(
                        env.corsProxyUrl,
                        `https://tile.tracestrack.com/${tracestrackMap(env.language)}/{z}/{x}/{y}{ratio}.webp`,
                    ),
                ],
                TRACESTRACK_ATTRIBUTION,
                { maxzoom: 19 },
            ),
        },
        {
            code: 'Of',
            title: 'OpenFreeMap Outdoor',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            // an own vector style on the OpenFreeMap tiles (the OpenMapTiles schema, up to z14), without a key: the
            // labels are the local name and under it the browser language or Latin script at any zoom (Tracestrack
            // translates only up to z12)
            labelLanguage: env.language,
            source: { type: 'vector', url: OPENFREEMAP_TILEJSON, attribution: OPENFREEMAP_ATTRIBUTION },
        },
        {
            code: 'O',
            title: 'OpenStreetMap',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], OSM_ATTRIBUTION),
        },
        {
            code: 'Co',
            title: 'CyclOSM',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(
                subdomains('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png'),
                `${OSM_ATTRIBUTION}. Tiles style by <a href="https://www.cyclosm.org/">CyclOSM</a>`,
            ),
        },
        {
            code: 'E',
            title: 'ESRI Satellite',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(
                ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                '<a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9">' +
                    'ESRI World Imagery for ArcGIS</a>',
            ),
        },
        {
            code: 'S2',
            title: 'Sentinel-2 cloudless',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            // directly: EOX reflects Origin in CORS, there is no key. The matrix g is GoogleMapsCompatible, the order
            // is {y}/{x}. maxzoom 14 is the EOX pyramid for EPSG:3857 (10 m per pixel); the server stretches z15+
            // tiles from the same data, and MapLibre does this itself without requests
            source: raster(
                [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${SENTINEL_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`],
                SENTINEL_ATTRIBUTION,
                { maxzoom: 14 },
            ),
        },
        {
            code: 'Hls',
            title: 'Satellite by date',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            dated: true,
            // directly: GIBS answers Access-Control-Allow-Origin: *, there is no key. A date without imagery over a
            // tile gives 200 with a transparent PNG, so the two satellites together give an image where at least one
            // of them captured it
            source: raster(
                HLS_LAYERS.map(
                    (layer) =>
                        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${DATE_TOKEN}` +
                        '/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png',
                ),
                HLS_ATTRIBUTION,
                { maxzoom: HLS_MAX_ZOOM },
            ),
        },
        {
            code: 'G',
            title: 'Google Map',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(googleTiles('m@169000000', env.language), GOOGLE_ATTRIBUTION),
        },
        {
            code: 'Gh',
            title: 'Google Hybrid',
            group: 'Miscellaneous',
            isOverlay: true,
            isDefault: false,
            source: raster(googleTiles('h@169000000', env.language), GOOGLE_SAT_ATTRIBUTION),
        },
        {
            code: 'L',
            title: 'Google Satellite',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(
                subdomains('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', '0123'),
                GOOGLE_SAT_ATTRIBUTION,
            ),
        },
        {
            code: 'P',
            title: 'Google Terrain',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            source: raster(
                googleTiles('t@130,r@206000000', env.language),
                '<a href="https://www.google.com/maps/@43.1203575,42.1105049,9.58z/data=!5m1!1e4">Google</a>',
            ),
        },
        {
            code: 'I',
            title: 'Bing Satellite',
            group: 'Default layers',
            isOverlay: false,
            isDefault: true,
            // the address is from bing.com/maps/style?styleid=aerial; without g= the tile answers 400, with any g it
            // is the same tile, so the address is static, without a style request, as the old BingSatLayer did
            source: raster(
                ['https://t.ssl.ak.tiles.virtualearth.net/tiles/a{quadkey}.jpeg?g=15625&n=z&prx=1'],
                '<a href="https://www.bing.com/maps?style=h">Microsoft</a>',
            ),
        },
        {
            code: 'Q',
            title: 'Slazav mountains',
            group: 'Default layers',
            isOverlay: true,
            isDefault: true,
            // slazav.xyz/tiles/hr/{x}-{y}-{z}.png answers 302 to here without a CORS header, and WebGL needs CORS on
            // each answer of the chain, so this is the final address at once
            source: raster(['https://tiles.slazav.xyz/hr/{z}/{x}/{y}.png'], SLAZAV_ATTRIBUTION, { maxzoom: 13 }),
        },
        {
            code: 'Z',
            title: 'Slazav Moscow region map',
            group: 'Default layers',
            isOverlay: true,
            isDefault: true,
            source: raster(['https://tiles.slazav.xyz/podm/{z}/{x}/{y}.png'], SLAZAV_ATTRIBUTION, { maxzoom: 14 }),
        },
        {
            code: 'Otm',
            title: 'OpenTopoMap',
            group: 'OpenStreetMap alternatives',
            isOverlay: false,
            isDefault: false,
            source: raster(
                subdomains('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'),
                '<a href="https://opentopomap.org/">OpenTopoMap</a>',
                { maxzoom: 17 },
            ),
        },
        {
            code: 'Ocm',
            title: 'OpenCycleMap',
            group: 'OpenStreetMap alternatives',
            isOverlay: false,
            isDefault: false,
            source: raster(
                subdomains('https://{s}.tile.thunderforest.com/cycle/{z}/{x}/{y}{ratio}.png'),
                '<a href="https://www.opencyclemap.org/">Thunderforest OpenCycleMap</a>',
            ),
        },
        {
            code: 'Oso',
            title: 'OSM Outdoors',
            group: 'OpenStreetMap alternatives',
            isOverlay: false,
            isDefault: false,
            source: raster(
                subdomains('https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}{ratio}.png'),
                '<a href="https://www.thunderforest.com/maps/outdoors/">Thunderforest Outdoors</a>',
            ),
        },
        {
            code: 'Mt',
            title: 'Mountains by Aleksey Tsvetkov',
            group: 'Default layers',
            isOverlay: true,
            isDefault: true,
            minZoom: 1,
            // the host does not give CORS: only through the proxy, as in the old client
            source: raster(
                [viaCorsProxy(env.corsProxyUrl, 'https://maptiles.website.yandexcloud.net/{z}/{x}/{y}.png')],
                '<a href="http://pereval.g-utka.ru/">Aleksey Tsvetkov</a>',
                { maxzoom: 15, bounds: [71.00007, 40.66664, 81.00001, 45.33338] },
            ),
        },
        {
            code: 'Ot',
            title: 'OpenStreetMap GPS traces',
            group: 'Routes and traces',
            isOverlay: true,
            isDefault: false,
            source: raster(
                subdomains('https://{s}.gps-tile.openstreetmap.org/lines/{z}/{x}/{y}.png'),
                '<a href="https://www.openstreetmap.org/#&layers=G">OpenStreetMap public GPS traces</a>',
            ),
        },
        stravaLayer('Sa', 'all', 'Strava heatmap (all)', env),
        stravaLayer('Sr', 'run', 'Strava heatmap (run)', env),
        stravaLayer('Sb', 'ride', 'Strava heatmap (ride)', env),
        stravaLayer('Sw', 'winter', 'Strava heatmap (winter)', env),
        {
            code: 'Np',
            title: 'Norway paper map',
            group: 'Norway',
            isOverlay: true,
            isDefault: false,
            source: raster(
                ['https://cache.kartverket.no/v1/wmts/1.0.0/toporaster/default/webmercator/{z}/{y}/{x}.png'],
                KARTVERKET_ATTRIBUTION,
                { bounds: NORWAY_BOUNDS },
            ),
        },
        {
            code: 'Nm',
            title: 'Norway topo',
            group: 'Norway',
            isOverlay: true,
            isDefault: false,
            source: raster(
                ['https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'],
                KARTVERKET_ATTRIBUTION,
                { bounds: NORWAY_BOUNDS },
            ),
        },
        {
            code: 'Nr',
            title: 'Norway roads',
            group: 'Norway',
            isOverlay: true,
            isDefault: false,
            // the host answers 500 for missing tiles, not 404: at the coverage border a layer error toast is possible
            source: raster(
                ['https://maptiles1.finncdn.no/tileService/1.0.3/normap/{z}/{x}/{y}.png'],
                '<a href="https://kart.finn.no/">finn.no</a>',
                { bounds: NORWAY_BOUNDS },
            ),
        },
        {
            code: 'Fmk',
            title: 'Finland Topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            // the old layer has a typo `bound`, so the rectangle did not apply; here it applies
            source: raster(
                [
                    'https://proxy.laji.fi/mml_wmts/maasto/wmts/1.0.0/maastokartta/default/WGS84_Pseudo-Mercator/' +
                        '{z}/{y}/{x}.png',
                ],
                '<a href="https://laji.fi/en/map/">LAJI.FI</a>',
                { bounds: [19.08321, 59.45416, 31.58671, 70.09211] },
            ),
        },
        {
            code: 'Gbt',
            title: 'Great Britain Topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            minZoom: 11,
            // the address is from bing.com/maps/style?styleid=ordnancesurvey without key=: the tile with CORS and the
            // same content comes without the session key too (checked 2026-10-08), so the page bing.com/maps through
            // the proxy is not necessary
            source: raster(
                [
                    'https://t.ssl.ak.dynamic.tiles.virtualearth.net/comp/ch/{quadkey}' +
                        '?mkt=&ur=ge&it=G,OS,BF,RL&og=2866&sv=9.48&n=t&o=webp,95&cstl=s23',
                ],
                '<a href="https://docs.microsoft.com/en-us/bingmaps/v8-web-control/map-control-api/' +
                    'maptypeid-enumeration">Ordnance Survey</a>',
                { maxzoom: 16, bounds: [-7.75643, 49.83793, 1.82356, 60.87164] },
            ),
        },
        {
            code: 'Wc',
            title: 'Waymarked Cycling Trails',
            group: 'Routes and traces',
            isOverlay: true,
            isDefault: false,
            source: raster(
                ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'],
                '<a href="https://cycling.waymarkedtrails.org/">Waymarked Cycling Trails</a>',
            ),
        },
        {
            code: 'Wh',
            title: 'Waymarked Hiking Trails',
            group: 'Routes and traces',
            isOverlay: true,
            isDefault: false,
            source: raster(
                ['https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png'],
                '<a href="https://hiking.waymarkedtrails.org/">Waymarked Hiking Trails</a>',
            ),
        },
        {
            code: 'St',
            title: 'Slovakia topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            minZoom: 9,
            // static.mapy.hiking.sk/topo/… answers 307 to here without a CORS header, so this is the final address
            // at once
            source: raster(
                ['https://tile.mapy.hiking.sk/otm/{z}/{x}/{y}.png'],
                '<a href="https://mapy.hiking.sk/">mapy.hiking.sk</a>',
                { maxzoom: 15, bounds: [16.74316, 47.5172, 22.74837, 49.91343] },
            ),
        },
        {
            code: 'Sp',
            title: 'Spain topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            source: raster(
                [
                    'https://www.ign.es/wmts/mapa-raster?layer=MTN&style=default&' +
                        'tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&' +
                        'Format=image%2Fjpeg&TileMatrix={z}&TileCol={x}&TileRow={y}',
                ],
                '<a href="https://www.ign.es/iberpix2/visor/">IGN (Spain) topographic map</a>',
                { bounds: [-9.51828, 35.9024, 4.50439, 43.8375] },
            ),
        },
        {
            code: 'Si',
            title: 'Switzerland topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            // the old layer: a 256 px tile in 128 CSS px with a zoom offset of 1 (tileSize 128, zoomOffset 1). In
            // MapLibre, the tile zoom = the map zoom + log2(512 / tileSize), so tileSize 128 gives the same offset.
            // Directly, without the proxy: the host gives CORS (checked 2026-10-08), and the proxy would spend its
            // limit.
            source: raster(
                [
                    'https://wmts10.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
                ],
                '<a href="https://map.geo.admin.ch/?topic=swisstopo&lang=en&bgLayer=' +
                    'ch.swisstopo.pixelkarte-farbe&E=2586000.76&N=1202020.96&zoom=1">Swisstopo</a>',
                { tileSize: 128, maxzoom: 17, bounds: [5.87352, 45.80269, 10.6847, 47.86445] },
            ),
        },
        {
            code: 'Se',
            title: 'Sweden topo',
            group: 'Topo maps',
            isOverlay: true,
            isDefault: false,
            source: raster(
                [
                    'https://minkarta.lantmateriet.se/map/topowebbcache' +
                        '?layer=topowebb&style=default&tilematrixset=3857&Service=WMTS&Request=GetTile&Version=1.0.0' +
                        '&Format=image%2Fpng&TileMatrix={z}&TileCol={x}&TileRow={y}',
                ],
                '<a href="https://minkarta.lantmateriet.se/">Lantmäteriet</a>',
                { maxzoom: 17, bounds: [10.58876, 55.13493, 24.18365, 69.072] },
            ),
        },
        {
            code: 'Hs',
            title: 'Relief shading',
            group: 'Miscellaneous',
            isOverlay: true,
            isDefault: true,
            source: {
                type: 'raster-dem',
                encoding: 'terrarium',
                tiles: [TERRARIUM_TILES],
                tileSize: 256,
                maxzoom: TERRARIUM_MAX_ZOOM,
                attribution: TERRAIN_ATTRIBUTION,
            },
        },
        {
            code: 'Ct',
            title: 'Contour lines',
            group: 'Miscellaneous',
            isOverlay: true,
            isDefault: true,
            // below z10 there are no contour lines, and the relief does not load for them (the zoom step is in
            // contours.ts); 512 px tiles by default: a contour tile zN is built from the relief tile zN and eight
            // neighbors
            minZoom: CONTOUR_MIN_ZOOM,
            source: {
                type: 'vector',
                tiles: [`${CONTOUR_PROTOCOL}://{z}/{x}/{y}`],
                minzoom: CONTOUR_MIN_ZOOM,
                maxzoom: TERRARIUM_MAX_ZOOM,
                attribution: TERRAIN_ATTRIBUTION,
            },
        },
    ];
}

export function buildCatalog(env: CatalogEnv): LayerDef[] {
    return definitions(env).map((def) => {
        const order = ORDER.indexOf(def.code) + 1;
        if (!order) {
            throw new Error(`Layer ${def.code} has no place in ORDER`);
        }
        return { ...def, order };
    });
}
