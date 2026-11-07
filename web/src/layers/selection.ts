import type { LayerDef } from './catalog';
import { isCustomLayerCode, parseCustomLayerCode } from './custom';
import { canonicalCustomCode, type Selection } from './settings';

// The default basemap is the vector OpenFreeMap Outdoor (owner 2026-10-30, design openfreemap-default-basemap): the
// public OpenFreeMap has no request limit, and the free quota of Tracestrack Topo (the previous default, since
// add-outdoor-basemap) was enough for ≈ 900 active visits per month (openspec/research/load-capacity.md). Before
// Tracestrack, the default was OpenStreetMap, the first layer of the old client list
export const DEFAULT_SELECTION: Selection = { base: 'Of', overlays: [] };

// The basemap fallback on an error of its tiles (App, the store basemapFallback): the next basemap in the chain
// Of → Tt → O. OpenFreeMap has no SLA, and a fallback to Tracestrack spends its quota only during a failure; OSM is the
// last one: the OSMF rules do not allow an app to load it heavily. O and the other basemaps have no next basemap: their
// errors give the usual toast
export const BASEMAP_FALLBACKS: Readonly<Record<string, string>> = { Of: 'Tt', Tt: 'O' };

export interface ParsedLayers {
    selection: Selection;
    // custom layers from the link (canonical codes): add them to the list if they are not there yet
    custom: string[];
}

// l= of old links by the rules of unserializeState of the old client (leaflet.hashState/Leaflet.Control.Layers.js and
// leaflet.control.layers.configure): unknown codes and codes of deleted layers are skipped; if the codes have no
// basemap, l= is ignored fully. Of several basemaps, the first one (the bottom one) is taken.
export function parseLayersParam(
    values: readonly string[] | undefined,
    catalog: ReadonlyMap<string, LayerDef>,
): ParsedLayers | null {
    if (!values?.length) {
        return null;
    }
    let base: string | null = null;
    const overlays: string[] = [];
    const custom: string[] = [];
    for (const value of values) {
        let code: string | null = value;
        let isOverlay: boolean;
        if (isCustomLayerCode(value)) {
            code = canonicalCustomCode(value);
            const fields = code ? parseCustomLayerCode(code) : null;
            if (!code || !fields) {
                continue;
            }
            if (!custom.includes(code)) {
                custom.push(code);
            }
            isOverlay = fields.isOverlay;
        } else {
            const layer = catalog.get(value);
            if (!layer) {
                continue;
            }
            isOverlay = layer.isOverlay;
        }
        if (!isOverlay) {
            base ??= code;
        } else if (!overlays.includes(code)) {
            overlays.push(code);
        }
    }
    return base ? { selection: { base, overlays }, custom } : null;
}

// A saved selection can refer to a layer that no longer exists (a deleted custom layer, an old code)
export function validSelection(selection: Selection | null, layers: ReadonlyMap<string, LayerDef>): Selection {
    if (!selection) {
        return DEFAULT_SELECTION;
    }
    const base = layers.get(selection.base);
    return {
        base: base && !base.isOverlay ? base.code : DEFAULT_SELECTION.base,
        overlays: [...new Set(selection.overlays)].filter((code) => layers.get(code)?.isOverlay),
    };
}

// l= for the address: codes from bottom to top, as serializeState of the old client (by the zIndex of the layers)
export function formatLayersParam(selection: Selection, layers: ReadonlyMap<string, LayerDef>): string[] {
    const overlays = selection.overlays
        .map((code) => layers.get(code))
        .filter((layer): layer is LayerDef => Boolean(layer))
        .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
        .map((layer) => layer.code);
    return [selection.base, ...overlays];
}
