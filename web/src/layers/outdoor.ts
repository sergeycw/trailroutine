import type {
    DataDrivenPropertyValueSpecification,
    ExpressionSpecification,
    FilterSpecification,
    FormattedSpecification,
    LayerSpecification,
} from 'maplibre-gl';

// The outdoor vector style of the basemap OpenFreeMap Outdoor (design add-vector-outdoor-style): the layers of the
// OpenMapTiles schema (https://openmaptiles.org/schema/) from the OpenFreeMap tiles. The style is a custom one, not
// Liberty: without glyphs and sprite, MapLibre 6 draws the labels with the system font, as the track labels
// (src/tracks/style.ts), and there are no POI icons.
//
// Layer ids are <code>-<name>: the suffix does not overlap with the codes of the catalog and of custom layers (-cs…),
// as Ct-labels.

// The colors are custom, in the manner of topo maps: forest and meadows are visible, trails and dirt roads are brighter
// than streets (research new-ui.md, «Рекомендация на потом»)
const LAND = '#f5f2e9';
const WOOD = '#c9dfae';
const GRASS = '#e2ebc7';
const WETLAND = '#d5e6df';
const ICE = '#f4f9ff';
const ICE_OUTLINE = '#9cc3e6';
const ROCK = '#e0dbd2';
const SAND = '#f1e5c2';
const FARMLAND = '#efecd8';
const RESIDENTIAL = '#e8e1d6';
const BUILDING = '#d9d0c3';
const WATER = '#a8cfe8';
const WATER_LABEL = '#3d6f9a';
const PROTECTED = '#4f8f3e';
const BOUNDARY = '#8a6a8a';
const TRACK = '#8b5a2b';
const PATH = '#c0392b';
const RAIL = '#8c8c8c';
const ROAD_CASING = '#b5aca0';
const LABEL = '#333333';
const HALO = 'rgba(255, 255, 255, 0.9)';
const FONT = ['sans-serif'];

// The size of the second label line relative to the first
const SECOND_LINE_SCALE = 0.85;

// The label language is the primary subtag of navigator.language (ru-RU → ru), as for the Tracestrack labels
// (tracestrackMap in catalog.ts). The name:<language> fields in the OpenMapTiles schema use the primary subtag
export function labelLanguage(language: string): string {
    return language.toLowerCase().split('-')[0];
}

type Section = ExpressionSpecification | string;

// A label in two lines (owner decision 2026-10-12, design «Подписи в две строки»): the local name at the top, under it
// name:<browser language>, and without a translation name:latin (the Latin script of the OpenMapTiles schema); the
// second line does not show if it is missing or if it is the same as the first. extra is the lines under the name (the
// peak elevation), they are always present. case in each branch gives the full format: the style specification does
// not accept format inside format
function labelFormat(language: string, extra: Section[] = []): ExpressionSpecification {
    const tail = extra.flatMap((section): (Section | object)[] => [
        '\n',
        {},
        section,
        { 'font-scale': SECOND_LINE_SCALE },
    ]);
    const one = (text: Section): ExpressionSpecification =>
        ['format', text, {}, ...tail] as unknown as ExpressionSpecification;
    // no name and no translation: only the extra lines, without an empty first line
    const none = ['format', ...(tail.length ? tail.slice(2) : ['', {}])] as unknown as ExpressionSpecification;
    const two = [
        'format',
        ['var', 'local'],
        {},
        '\n',
        {},
        ['var', 'second'],
        { 'font-scale': SECOND_LINE_SCALE },
        ...tail,
    ];
    return [
        'let',
        'local',
        ['coalesce', ['get', 'name'], ''],
        'second',
        ['coalesce', ['get', `name:${labelLanguage(language)}`], ['get', 'name:latin'], ''],
        [
            'case',
            ['all', ['==', ['var', 'local'], ''], ['==', ['var', 'second'], '']],
            none,
            ['==', ['var', 'local'], ''],
            one(['var', 'second']),
            ['any', ['==', ['var', 'second'], ''], ['==', ['var', 'second'], ['var', 'local']]],
            one(['var', 'local']),
            two,
        ],
    ] as unknown as ExpressionSpecification;
}

export function labelText(language: string): DataDrivenPropertyValueSpecification<FormattedSpecification> {
    return labelFormat(language);
}

// Peaks and passes: the mark as text (there is no sprite) and the elevation in meters as a line under the name.
// Without a name, only the elevation line
export function peakText(language: string): DataDrivenPropertyValueSpecification<FormattedSpecification> {
    const mark = ['match', ['get', 'class'], 'saddle', ')(', '▲'] as ExpressionSpecification;
    const elevation = [
        'case',
        ['has', 'ele'],
        // ele can be fractional (2494.3 at the peak above Upper Lars): round to the meter
        ['concat', mark, ' ', ['to-string', ['round', ['get', 'ele']]], ' m'],
        mark,
    ] as ExpressionSpecification;
    return labelFormat(language, [elevation]);
}

function classIn(...classes: string[]): ExpressionSpecification {
    return ['match', ['get', 'class'], classes, true, false];
}

// line width by zoom: [zoom, px]…, exponential, as the road widths in the OpenMapTiles styles; px can depend on
// properties (river, country), but the zoom can be only in the outer expression
function width(...stops: (number | ExpressionSpecification)[]): ExpressionSpecification {
    return ['interpolate', ['exponential', 1.4], ['zoom'], ...stops] as ExpressionSpecification;
}

function river(main: number, other: number): ExpressionSpecification {
    return ['match', ['get', 'class'], 'river', main, other];
}

function country(main: number, other: number): ExpressionSpecification {
    return ['match', ['get', 'admin_level'], 2, main, other];
}

function placeSize(city: number, town: number, village: number, other: number): ExpressionSpecification {
    return ['match', ['get', 'class'], 'city', city, 'town', town, 'village', village, other];
}

interface Road {
    name: string;
    classes: string[];
    color: string;
    // [zoom, px]… of the fill widths; the casing is 2 px wider
    widths: number[];
    minzoom: number;
}

// The transportation classes of the OpenMapTiles schema, from large to small; *_construction draw as the usual classes
const ROADS: Road[] = [
    {
        name: 'motorway',
        classes: ['motorway', 'motorway_construction'],
        color: '#f2a65a',
        widths: [5, 0.8, 10, 2.5, 14, 6, 18, 18],
        minzoom: 4,
    },
    {
        name: 'trunk',
        classes: ['trunk', 'primary', 'trunk_construction', 'primary_construction'],
        color: '#f7c873',
        widths: [6, 0.6, 10, 2, 14, 5, 18, 16],
        minzoom: 5,
    },
    {
        name: 'secondary',
        classes: ['secondary', 'tertiary', 'secondary_construction', 'tertiary_construction'],
        color: '#fbe7a6',
        widths: [8, 0.5, 11, 1.5, 14, 4, 18, 14],
        minzoom: 8,
    },
    {
        name: 'minor',
        classes: ['minor', 'service', 'minor_construction', 'service_construction', 'busway', 'raceway'],
        color: '#ffffff',
        widths: [12, 0.5, 14, 2, 18, 10],
        minzoom: 12,
    },
];

// from bottom to top: the casings of all roads, then the fills, so the casings do not cut the crossings
function roadLayers(code: string): LayerSpecification[] {
    const base = (road: Road) => ({
        source: code,
        'source-layer': 'transportation',
        minzoom: road.minzoom,
        filter: ['all', classIn(...road.classes), ['!=', ['get', 'brunnel'], 'tunnel']] as FilterSpecification,
        layout: { 'line-cap': 'round', 'line-join': 'round' } as const,
    });
    const reversed = [...ROADS].reverse();
    return [
        ...reversed.map(
            (road): LayerSpecification => ({
                id: `${code}-${road.name}-casing`,
                type: 'line',
                ...base(road),
                paint: {
                    'line-color': ROAD_CASING,
                    'line-width': width(...road.widths.map((value, index) => (index % 2 ? value + 2 : value))),
                },
            }),
        ),
        ...reversed.map(
            (road): LayerSpecification => ({
                id: `${code}-${road.name}`,
                type: 'line',
                ...base(road),
                paint: { 'line-color': road.color, 'line-width': width(...road.widths) },
            }),
        ),
    ];
}

function labelPaint(color = LABEL) {
    return { 'text-color': color, 'text-halo-color': HALO, 'text-halo-width': 1.5 };
}

export function outdoorLayers(code: string, language: string): LayerSpecification[] {
    const source = { source: code };
    return [
        // vector tiles do not fill the land: the land background is an own style layer above the gray map background
        // (BACKGROUND_LAYER)
        { id: `${code}-land`, type: 'background', paint: { 'background-color': LAND } },
        {
            id: `${code}-landuse`,
            type: 'fill',
            ...source,
            'source-layer': 'landuse',
            filter: classIn('residential', 'suburb', 'neighbourhood', 'quarter', 'commercial', 'industrial', 'retail'),
            paint: { 'fill-color': RESIDENTIAL, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1] },
        },
        {
            id: `${code}-landcover`,
            type: 'fill',
            ...source,
            'source-layer': 'landcover',
            paint: {
                'fill-color': [
                    'match',
                    ['get', 'class'],
                    'wood',
                    WOOD,
                    ['grass', 'scrub'],
                    GRASS,
                    'wetland',
                    WETLAND,
                    'ice',
                    ICE,
                    'rock',
                    ROCK,
                    'sand',
                    SAND,
                    'farmland',
                    FARMLAND,
                    'transparent',
                ],
            },
        },
        {
            id: `${code}-glacier-outline`,
            type: 'line',
            ...source,
            'source-layer': 'landcover',
            minzoom: 9,
            filter: classIn('ice'),
            paint: { 'line-color': ICE_OUTLINE, 'line-width': 0.8, 'line-dasharray': [3, 2] },
        },
        {
            id: `${code}-protected`,
            type: 'line',
            ...source,
            'source-layer': 'park',
            minzoom: 7,
            // pale: the Kazbegi park in the tiles is many pieces, and at z13+ a bright dash line outlined each piece
            // (screenshot 2026-10-12)
            paint: { 'line-color': PROTECTED, 'line-width': 0.8, 'line-opacity': 0.3, 'line-dasharray': [4, 2] },
        },
        {
            id: `${code}-water`,
            type: 'fill',
            ...source,
            'source-layer': 'water',
            filter: ['!=', ['get', 'brunnel'], 'tunnel'],
            paint: { 'fill-color': WATER },
        },
        {
            id: `${code}-waterway`,
            type: 'line',
            ...source,
            'source-layer': 'waterway',
            filter: ['!=', ['get', 'brunnel'], 'tunnel'],
            layout: { 'line-cap': 'round' },
            paint: {
                'line-color': WATER,
                // the zoom is outside: the style specification allows interpolate by zoom only in the top expression
                'line-width': width(8, river(0.8, 0), 11, river(1.5, 0.4), 14, river(3, 1), 16, river(6, 2.5)),
            },
        },
        {
            id: `${code}-building`,
            type: 'fill',
            ...source,
            'source-layer': 'building',
            minzoom: 13,
            paint: { 'fill-color': BUILDING, 'fill-opacity': 0.8 },
        },
        ...roadLayers(code),
        {
            id: `${code}-track`,
            type: 'line',
            ...source,
            'source-layer': 'transportation',
            minzoom: 11,
            filter: classIn('track'),
            paint: { 'line-color': TRACK, 'line-width': width(11, 0.8, 14, 1.6, 18, 3), 'line-dasharray': [3, 1.5] },
        },
        {
            // trails, footways, bridleways and cycleways are subclass in OpenMapTiles; a path is brighter than streets
            // on forest and meadows
            id: `${code}-path`,
            type: 'line',
            ...source,
            'source-layer': 'transportation',
            minzoom: 12,
            filter: ['all', classIn('path'), ['!=', ['get', 'brunnel'], 'tunnel']],
            paint: { 'line-color': PATH, 'line-width': width(12, 0.8, 14, 1.3, 18, 2.5), 'line-dasharray': [2, 1.5] },
        },
        {
            id: `${code}-rail`,
            type: 'line',
            ...source,
            'source-layer': 'transportation',
            minzoom: 8,
            filter: ['all', classIn('rail', 'transit'), ['!=', ['get', 'brunnel'], 'tunnel']],
            paint: { 'line-color': RAIL, 'line-width': width(8, 0.6, 14, 1.5, 18, 3) },
        },
        {
            id: `${code}-ferry`,
            type: 'line',
            ...source,
            'source-layer': 'transportation',
            filter: classIn('ferry'),
            paint: { 'line-color': WATER_LABEL, 'line-width': 1, 'line-dasharray': [4, 3] },
        },
        {
            id: `${code}-boundary`,
            type: 'line',
            ...source,
            'source-layer': 'boundary',
            filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
            layout: { 'line-join': 'round' },
            paint: {
                'line-color': BOUNDARY,
                'line-opacity': 0.7,
                'line-width': width(3, country(0.8, 0.3), 10, country(2, 0.8), 14, country(3, 1.5)),
                'line-dasharray': ['case', ['==', ['get', 'disputed'], 1], ['literal', [2, 2]], ['literal', [6, 2]]],
            },
        },
        {
            id: `${code}-waterway-labels`,
            type: 'symbol',
            ...source,
            'source-layer': 'waterway',
            minzoom: 11,
            layout: {
                'symbol-placement': 'line',
                'text-field': labelText(language),
                'text-font': FONT,
                'text-size': 11,
            },
            paint: labelPaint(WATER_LABEL),
        },
        {
            id: `${code}-water-labels`,
            type: 'symbol',
            ...source,
            'source-layer': 'water_name',
            layout: { 'text-field': labelText(language), 'text-font': FONT, 'text-size': 12, 'text-max-width': 8 },
            paint: labelPaint(WATER_LABEL),
        },
        {
            id: `${code}-road-labels`,
            type: 'symbol',
            ...source,
            'source-layer': 'transportation_name',
            minzoom: 13,
            layout: {
                'symbol-placement': 'line',
                'text-field': labelText(language),
                'text-font': FONT,
                'text-size': 11,
            },
            paint: labelPaint(),
        },
        {
            id: `${code}-peaks`,
            type: 'symbol',
            ...source,
            'source-layer': 'mountain_peak',
            filter: classIn('peak', 'volcano', 'saddle'),
            layout: {
                'text-field': peakText(language),
                'text-font': FONT,
                'text-size': 11,
                'text-max-width': 8,
                // OpenMapTiles rank: smaller is more important
                'symbol-sort-key': ['get', 'rank'],
            },
            paint: labelPaint('#5b3a1e'),
        },
        {
            id: `${code}-places`,
            type: 'symbol',
            ...source,
            'source-layer': 'place',
            filter: classIn(
                'city',
                'town',
                'village',
                'hamlet',
                'suburb',
                'quarter',
                'neighbourhood',
                'locality',
                'island',
            ),
            layout: {
                'text-field': labelText(language),
                'text-font': FONT,
                'text-size': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    6,
                    placeSize(12, 9, 8, 8),
                    10,
                    placeSize(15, 12, 10, 10),
                    14,
                    placeSize(20, 17, 14, 12),
                ],
                'text-max-width': 8,
                'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
            },
            paint: labelPaint(),
        },
        {
            id: `${code}-regions`,
            type: 'symbol',
            ...source,
            'source-layer': 'place',
            maxzoom: 9,
            filter: classIn('country', 'state'),
            layout: {
                'text-field': labelText(language),
                'text-font': FONT,
                'text-size': ['match', ['get', 'class'], 'country', 14, 11],
                'text-transform': 'uppercase',
                'text-letter-spacing': 0.1,
                'text-max-width': 8,
            },
            paint: labelPaint(BOUNDARY),
        },
    ];
}
