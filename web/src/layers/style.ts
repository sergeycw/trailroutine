import type { GeoJSONSourceSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { PROFILE_LAYERS, PROFILE_SOURCES } from '@/elevation/style';
import { EDIT_LAYERS, editSources } from '@/routing/edit-style';
import type { RouteEditState } from '@/state/store';
import type { Track } from '@/tracks/model';
import { TRACK_LAYERS, trackSources } from '@/tracks/style';
import type { LayerDef } from './catalog';
import { CONTOUR_ELEVATION, CONTOUR_LAYER, CONTOUR_LEVEL } from './contours';
import { outdoorLayers } from './outdoor';

// The map style from the layers that are on: the basemap at the bottom, the overlays in the catalog stacking order, not
// in the order in which they were turned on (titlesByOrder of the old client). One source and one layer per code (the
// contour lines also have labels, dated imagery has one source for each GIBS layer), id = code: when the selection
// changes, react-maplibre gives the new style to setStyle with diff, and the sources that stayed do not reload.
// Under the layers is a gray background, as in the old client: while the tiles load or after a basemap change, it
// shows, not a white page (owner decision, change gray-map-background). The tracks are above all layers
// (src/tracks/style.ts), the edited line is above them (src/routing/edit-style.ts); the selected section of the
// elevation profile is under the tracks (src/elevation/style.ts). The map builds their sources (overlay) itself and
// memoizes them separately: the MapLibre style diff compares the GeoJSON data of all sources on each update.
export function overlaySources(
    tracks: readonly Track[] = [],
    edit: { state: RouteEditState | null; color: string; drag: number | null } | null = null,
): Record<string, GeoJSONSourceSpecification> {
    const skip = edit?.state ? { trackId: edit.state.trackId, segment: edit.state.segment } : null;
    return {
        ...trackSources(tracks, skip).sources,
        ...editSources(edit?.state ?? null, edit?.color ?? '', edit?.drag ?? null),
        ...PROFILE_SOURCES,
    };
}

function emptyOverlay() {
    return overlaySources();
}

export function buildStyle(
    layers: readonly LayerDef[],
    overlay: Record<string, GeoJSONSourceSpecification> = emptyOverlay(),
): StyleSpecification {
    const sorted = [...layers].sort(
        (a, b) => Number(a.isOverlay) - Number(b.isOverlay) || a.order - b.order || a.code.localeCompare(b.code),
    );
    return {
        version: 8,
        sources: { ...Object.fromEntries(sorted.flatMap(layerSources)), ...overlay },
        layers: [BACKGROUND_LAYER, ...catalogLayers(sorted), ...PROFILE_LAYERS, ...TRACK_LAYERS, ...EDIT_LAYERS],
    };
}

// The relief shading right above the vector basemap goes inside its style, under the water, the roads and the labels
// (change outdoor-relief-in-style): the shadows do not darken the lines and the labels of the basemap. An overlay
// between them (an opaque map of the catalog or a custom layer) keeps the relief at its catalog place, above that
// overlay, as on the other basemaps. The basemap is always first: sorted puts the overlays after it.
function catalogLayers(sorted: readonly LayerDef[]): LayerSpecification[] {
    const [base, next] = sorted;
    if (base && next && isVectorBasemap(base) && next.source.type === 'raster-dem') {
        return [
            ...outdoorLayers(base.code, base.labelLanguage ?? '', layerSpecs(next)),
            ...sorted.slice(2).flatMap(layerSpecs),
        ];
    }
    return sorted.flatMap(layerSpecs);
}

function isVectorBasemap(layer: LayerDef): boolean {
    return layer.source.type === 'vector' && !layer.isOverlay;
}

// multidirectional is the recommendation of the research new-ui.md («Подложка по умолчанию»): shadows from several
// directions are readable on any basemap. The slope highlight is transparent: the default white highlight makes a
// raster basemap so light that the OSM labels and roads are almost not visible (owner remark 2026-10-08); only the
// shadows stay.
export const HILLSHADE_PAINT = {
    'hillshade-method': 'multidirectional',
    'hillshade-highlight-color': 'rgba(255, 255, 255, 0)',
    'hillshade-shadow-color': 'rgba(0, 0, 0, 0.4)',
    'hillshade-accent-color': 'rgba(0, 0, 0, 0.2)',
} as const;

// #ddd is the background of .leaflet-container in leaflet.css 1.0.3 of the old client (src/ does not override it). The
// id does not overlap with the codes of the catalog layers and of custom layers (-cs…).
export const BACKGROUND_LAYER = {
    id: 'background',
    type: 'background',
    paint: { 'background-color': '#ddd' },
} as const satisfies LayerSpecification;

// Contour lines (design add-contour-lines, «Вид»). The color is orange-brown: the dark brown of topo maps is not
// visible on a satellite image in a forest. The main lines are thicker and have a number label without units; the font
// is a CSS family without glyphs, as the labels of track points (src/tracks/style.ts)
function contourLayers(code: string, zoom: { minzoom?: number }): LayerSpecification[] {
    return [
        {
            id: code,
            type: 'line',
            source: code,
            'source-layer': CONTOUR_LAYER,
            ...zoom,
            paint: {
                'line-color': 'rgba(200, 105, 30, 0.75)',
                'line-width': ['match', ['get', CONTOUR_LEVEL], 1, 1, 0.5],
            },
        },
        {
            id: `${code}-labels`,
            type: 'symbol',
            source: code,
            'source-layer': CONTOUR_LAYER,
            ...zoom,
            filter: ['>', ['get', CONTOUR_LEVEL], 0],
            layout: {
                'symbol-placement': 'line',
                'text-field': ['to-string', ['get', CONTOUR_ELEVATION]],
                'text-font': ['sans-serif'],
                'text-size': 10,
            },
            paint: {
                'text-color': 'rgb(120, 65, 20)',
                'text-halo-color': 'white',
                'text-halo-width': 1,
            },
        },
    ];
}

// Dated imagery (design add-dated-imagery): each template of a layer with dated is its own source and layer, from
// bottom to top; the top one has id = code, the lower ones code@index. «@» is not in the catalog codes and not in the
// base64url of custom layers (-cs…), so the layer code of a source id is the part before «@» (layerCodeOfSource: tile
// errors)
function datedIds(layer: LayerDef): string[] {
    const count = layer.source.tiles?.length ?? 0;
    return Array.from({ length: count }, (_, index) => (index === count - 1 ? layer.code : `${layer.code}@${index}`));
}

export function layerCodeOfSource(sourceId: string): string {
    return sourceId.split('@')[0];
}

function layerSources(layer: LayerDef): [string, LayerDef['source']][] {
    if (!layer.dated) {
        return [[layer.code, layer.source]];
    }
    const tiles = layer.source.tiles ?? [];
    return datedIds(layer).map((id, index) => [id, { ...layer.source, tiles: [tiles[index]] }]);
}

// Vector sources of the catalog: the basemap OpenFreeMap Outdoor (a custom style of many layers, src/layers/outdoor.ts)
// and the contour line overlay (custom layers are raster). Layer ids with a suffix do not overlap with the codes of the
// catalog and of custom layers (-cs…)
function layerSpecs(layer: LayerDef): LayerSpecification[] {
    const zoom = layer.minZoom === undefined ? {} : { minzoom: layer.minZoom };
    if (isVectorBasemap(layer)) {
        return outdoorLayers(layer.code, layer.labelLanguage ?? '');
    }
    if (layer.source.type === 'vector') {
        return contourLayers(layer.code, zoom);
    }
    if (layer.source.type === 'raster-dem') {
        return [
            {
                id: layer.code,
                type: 'hillshade',
                source: layer.code,
                ...zoom,
                paint: HILLSHADE_PAINT,
            },
        ];
    }
    const ids = layer.dated ? datedIds(layer) : [layer.code];
    return ids.map((id) => ({
        id,
        type: 'raster',
        source: id,
        ...zoom,
        ...(layer.opacity === undefined ? {} : { paint: { 'raster-opacity': layer.opacity } }),
    }));
}
