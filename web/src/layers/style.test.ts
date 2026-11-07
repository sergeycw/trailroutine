import { createExpression, latest, type StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import { expect, test } from 'vitest';
import { PROFILE_SELECTION } from '@/elevation/style';
import { EDIT_LAYERS, EDIT_LEGS, EDIT_PREVIEW, EDIT_WAYPOINTS } from '@/routing/edit-style';
import { TRACK_COLORS } from '@/tracks/model';
import {
    TRACK_CASING,
    TRACK_LABELS,
    TRACK_LINES,
    TRACK_POINTS,
    TRACK_TICKS,
    TRACK_UNROUTED,
    TRACK_UNROUTED_CASING,
} from '@/tracks/style';
import { buildCatalog, type LayerDef } from './catalog';
import { withDate } from './dated';
import { outdoorLayers } from './outdoor';
import { BACKGROUND_LAYER, buildStyle, HILLSHADE_PAINT, layerCodeOfSource, overlaySources } from './style';

// the track and editor layers are above all map layers (always present, empty without tracks)
// the selected section of the elevation profile is under the tracks, the tracks are under the edited line
const TRACKS = [
    PROFILE_SELECTION,
    TRACK_CASING,
    TRACK_LINES,
    TRACK_UNROUTED_CASING,
    TRACK_UNROUTED,
    TRACK_TICKS,
    TRACK_POINTS,
    TRACK_LABELS,
    ...EDIT_LAYERS.map((layer) => layer.id),
];
const OVERLAY_SOURCES = [
    TRACK_LINES,
    TRACK_UNROUTED,
    TRACK_POINTS,
    TRACK_TICKS,
    EDIT_LEGS,
    EDIT_PREVIEW,
    EDIT_WAYPOINTS,
    PROFILE_SELECTION,
];

const catalog = buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' });

function pick(...codes: string[]) {
    return codes.map((code) => catalog.find((layer) => layer.code === code) as LayerDef);
}

test('подложка снизу, оверлеи по порядку наложения, а не по порядку включения', () => {
    const style = buildStyle(pick('Sa', 'Nm', 'Hs', 'O'));
    expect(style.layers.map((layer) => layer.id)).toEqual(['background', 'O', 'Nm', 'Hs', 'Sa', ...TRACKS]);
    expect(Object.keys(style.sources).sort()).toEqual(['Hs', 'Nm', 'O', 'Sa', ...OVERLAY_SOURCES].sort());
});

test('Горизонтали над отмывкой: линии и подписи над отмывкой, под тепловой картой Strava', () => {
    const style = buildStyle(pick('Sa', 'Ct', 'Hs', 'O'));
    expect(style.layers.map((layer) => layer.id)).toEqual([
        'background',
        'O',
        'Hs',
        'Ct',
        'Ct-labels',
        'Sa',
        ...TRACKS,
    ]);
    expect(Object.keys(style.sources)).toContain('Ct');
    const [lines, labels] = style.layers.filter((layer) => layer.id.startsWith('Ct'));
    // the main lines (level 1) are thicker than the intermediate lines
    expect(lines).toMatchObject({
        type: 'line',
        source: 'Ct',
        'source-layer': 'contours',
        minzoom: 10,
        paint: { 'line-width': ['match', ['get', 'level'], 1, 1, 0.5] },
    });
    // labels only on the main contour lines (level 1), the elevation as a number
    expect(labels).toMatchObject({
        type: 'symbol',
        source: 'Ct',
        'source-layer': 'contours',
        minzoom: 10,
        filter: ['>', ['get', 'level'], 0],
        layout: { 'symbol-placement': 'line', 'text-field': ['to-string', ['get', 'ele']] },
    });
});

test('Подложка OpenFreeMap Outdoor: слои своего стиля одним источником, горизонтали над ней — свои', () => {
    const [of] = pick('Of');
    const ru = { ...of, labelLanguage: 'ru-RU' };
    const style = buildStyle([...pick('Ct', 'Hs'), ru]);
    const own = outdoorLayers('Of', 'ru-RU').map((layer) => layer.id);
    expect(style.layers.map((layer) => layer.id)).toEqual(['background', ...own, 'Hs', 'Ct', 'Ct-labels', ...TRACKS]);
    expect(style.sources.Of).toEqual(of.source);
    expect(style.layers.filter((layer) => 'source' in layer && layer.source === 'Of').length).toBeGreaterThan(10);
    expect(style.layers).toEqual(expect.arrayContaining(outdoorLayers('Of', 'ru-RU')));
    expect(style).not.toHaveProperty('glyphs');
    expect(style).not.toHaveProperty('sprite');
});

test('Снимок за дату из ссылки: Landsat и Sentinel-2 — по своему источнику, Sentinel-2 сверху', () => {
    const [hls, hs] = pick('Hls', 'Hs');
    const style = buildStyle([hs, withDate(hls, '2026-10-05')]);
    expect(style.layers.map((layer) => layer.id)).toEqual(['background', 'Hls@0', 'Hls', 'Hs', ...TRACKS]);
    const tiles = (id: string) => (style.sources[id] as { tiles: string[] }).tiles;
    expect(tiles('Hls@0')).toEqual([
        expect.stringContaining('/HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/2026-10-05/'),
    ]);
    expect(tiles('Hls')).toEqual([
        expect.stringContaining('/HLS_S30_Nadir_BRDF_Adjusted_Reflectance/default/2026-10-05/'),
    ]);
    expect(style.sources.Hls).toMatchObject({ type: 'raster', maxzoom: 12, tileSize: 256 });
    expect(layerCodeOfSource('Hls@0')).toBe('Hls');
    expect(layerCodeOfSource('O')).toBe('O');
});

test('отмывка — слой hillshade поверх raster-dem', () => {
    const style = buildStyle(pick('O', 'Hs'));
    expect(style.sources.Hs).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
    expect(style.layers[2]).toEqual({
        id: 'Hs',
        type: 'hillshade',
        source: 'Hs',
        paint: HILLSHADE_PAINT,
    });
    // no white highlight: it makes the basemap lighter
    expect(HILLSHADE_PAINT['hillshade-highlight-color']).toMatch(/, 0\)$/);
});

test('прозрачность Strava и минимальный зум региональных слоёв', () => {
    const style = buildStyle(pick('O', 'Sa', 'Gbt'));
    expect(style.layers.find((layer) => layer.id === 'Sa')).toMatchObject({ paint: { 'raster-opacity': 0.75 } });
    expect(style.layers.find((layer) => layer.id === 'Gbt')).toMatchObject({ minzoom: 11 });
    expect(style.layers.find((layer) => layer.id === 'O')).toEqual({ id: 'O', type: 'raster', source: 'O' });
});

test('атрибуция — в источниках, MapLibre собирает её в подпись карты', () => {
    const style = buildStyle(pick('O', 'Wh'));
    expect(style.sources.O).toHaveProperty('attribution', expect.stringContaining('OpenStreetMap'));
    expect(style.sources.Wh).toHaveProperty('attribution', expect.stringContaining('Waymarked Hiking Trails'));
});

test('серый фон старого клиента — первым слоем, под подложкой', () => {
    const style = buildStyle(pick('E'));
    expect(style.layers[0]).toEqual(BACKGROUND_LAYER);
    expect(BACKGROUND_LAYER.paint['background-color']).toBe('#ddd');
    expect(style.layers.map((layer) => layer.id)).toEqual(['background', 'E', ...TRACKS]);
});

test('Трек над слоями: линии и точки треков — последними слоями, скрытый трек не рисуется', () => {
    const base = { segments: [], points: [], measureTicksShown: false };
    const style = buildStyle(
        pick('O', 'Hs'),
        overlaySources([
            {
                ...base,
                id: 'a',
                name: 'A',
                color: 1,
                visible: true,
                segments: [
                    [
                        { lat: 1, lng: 2 },
                        { lat: 3, lng: 4 },
                    ],
                ],
                points: [{ lat: 1, lng: 2, name: 'P' }],
            },
            { ...base, id: 'b', name: 'B', color: 2, visible: false, points: [{ lat: 5, lng: 6, name: 'Q' }] },
        ]),
    );
    expect(style.layers.slice(-TRACKS.length).map((layer) => layer.id)).toEqual(TRACKS);
    expect(style.sources[TRACK_LINES]).toMatchObject({
        data: {
            features: [
                {
                    properties: { id: 'a', segment: 0, color: TRACK_COLORS[1] },
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [2, 1],
                            [4, 3],
                        ],
                    },
                },
            ],
        },
    });
    expect(style.sources[TRACK_POINTS]).toMatchObject({
        data: { features: [{ properties: { name: 'P', color: TRACK_COLORS[1] }, geometry: { coordinates: [2, 1] } }] },
    });
    // labels without glyphs: MapLibre draws them locally
    expect(style.glyphs).toBeUndefined();
});

// The line offset at a zoom: the MapLibre style-spec calculates the style expression, as the map does
const LINE_OFFSET = latest.paint_line['line-offset'] as unknown as StylePropertySpecification;
function offsetAt(value: unknown, zoom: number): number {
    const parsed = createExpression(value, 'line-offset', LINE_OFFSET);
    if (parsed.result !== 'success') {
        throw new Error(JSON.stringify(parsed.value));
    }
    return parsed.value.evaluate({ zoom }) as number;
}

function lineOffsets(): Record<string, unknown> {
    return Object.fromEntries(
        buildStyle([])
            .layers.filter((layer) => layer.type === 'line')
            .map((layer) => [layer.id, (layer.paint as { 'line-offset'?: unknown } | undefined)?.['line-offset']]),
    );
}

// the lines that are offset together: tracks, legs that are not routed, the profile selection and the editor without
// the rubber band
const OFFSET_LINES = [
    TRACK_CASING,
    TRACK_LINES,
    TRACK_UNROUTED_CASING,
    TRACK_UNROUTED,
    PROFILE_SELECTION,
    ...EDIT_LAYERS.filter((item) => item.type === 'line' && item.id !== EDIT_PREVIEW).map((item) => item.id),
];

test('Радиалка: с зума 14 линии треков, редактора и выделение профиля смещены вправо по ходу на половину обводки', () => {
    const offsets = lineOffsets();
    const casing = buildStyle([]).layers.find((layer) => layer.id === TRACK_CASING) as {
        paint: { 'line-width': number };
    };
    for (const id of OFFSET_LINES) {
        // the casings of the two directions touch: the offset is half of the track casing width
        expect(offsetAt(offsets[id], 14), id).toBe(casing.paint['line-width'] / 2);
        expect(offsetAt(offsets[id], 16), id).toBe(casing.paint['line-width'] / 2);
    }
    // the rubber band is a straight line to the cursor, do not offset it
    expect(offsets[EDIT_PREVIEW]).toBeUndefined();
});

test('Радиалка на обзоре: до зума 13 включительно линии не смещены', () => {
    const offsets = lineOffsets();
    for (const id of OFFSET_LINES) {
        expect(offsetAt(offsets[id], 12), id).toBe(0);
        expect(offsetAt(offsets[id], 13), id).toBe(0);
        // between the thresholds, the lines move apart smoothly, without a jump
        expect(offsetAt(offsets[id], 13.5), id).toBeCloseTo(1.75);
    }
});
