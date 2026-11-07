import type { LayerDef } from './catalog';
import { isCustomLayerCode, parseCustomLayerCode, serializeCustomLayer } from './custom';
import { quickGroupOf } from './quick-layers';

// Layer settings of the new app in localStorage. An own key: the origin is shared with the old client, and the app
// only reads its leafletLayersSettings, one time, while there are no own settings (design, «Настройки»).

export const STORAGE_KEY = 'nakarte-web:layers';
export const LEGACY_STORAGE_KEY = 'leafletLayersSettings';

export interface Selection {
    base: string;
    // the order is not important: the catalog sets the stacking
    overlays: string[];
}

export interface LayerSettings {
    // whether to show the layer in the switcher; no code — the default (listedByDefault), so a new layer by default
    // appears also for users who already have saved settings (as in the old client)
    listed: Record<string, boolean>;
    // the codes of custom layers -cs… in the order of addition
    custom: string[];
    // the last selection; it applies if the address has no valid l=
    selection: Selection | null;
    // the column memory: the first code of a group → the group layer that was selected last (quick-layers.ts, design
    // quick-layer-menus). Settings without the field (before quick-layer-menus) give an empty memory, the format
    // version stays the same
    quickLayers: Record<string, string>;
}

// The format stays version 1: the code before custom-bases-in-list does not read settings of another version, and a
// rollback (revert) would erase the custom layers and the selection. The field groupDefaults: true means that listed
// was written when the column group layers were already in the list by default, and "unchecked" for them is the user
// choice. Without the field (before, and in the old client) the check marks were written all at once, and "unchecked"
// for a group layer without isDefault is the previous default, not a choice: the read drops such entries (upgrade in
// loadSettings)
interface StoredSettings extends LayerSettings {
    version: 1;
    groupDefaults: true;
}

export const EMPTY_SETTINGS: LayerSettings = { listed: {}, custom: [], selection: null, quickLayers: {} };

// A custom layer in the settings and in links is stored as a canonical code: the old client re-encoded the code at
// load (upgrade isTop), and the duplicate comparison uses the code
export function canonicalCustomCode(code: string): string | null {
    const fields = parseCustomLayerCode(code);
    return fields ? serializeCustomLayer(fields) : null;
}

function readStorage(storage: Storage, key: string): unknown {
    try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        // no storage (private mode, the site is blocked) or broken JSON: as if there are no settings
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOwn(
    raw: unknown,
    upgrade: (listed: Record<string, boolean>) => Record<string, boolean>,
): LayerSettings | null {
    if (!isRecord(raw) || raw.version !== 1) {
        return null;
    }
    const listed = isRecord(raw.listed) ? (raw.listed as Record<string, boolean>) : {};
    const selection = isRecord(raw.selection) && typeof raw.selection.base === 'string' ? raw.selection : null;
    return {
        listed: raw.groupDefaults === true ? listed : upgrade(listed),
        custom: Array.isArray(raw.custom) ? raw.custom.filter((code) => typeof code === 'string') : [],
        selection: selection
            ? {
                  base: selection.base as string,
                  overlays: Array.isArray(selection.overlays)
                      ? selection.overlays.filter((code) => typeof code === 'string')
                      : [],
              }
            : null,
        quickLayers: isRecord(raw.quickLayers)
            ? renameQuickKeys(
                  Object.fromEntries(
                      Object.entries(raw.quickLayers).filter(([, code]) => typeof code === 'string'),
                  ) as Record<string, string>,
              )
            : {},
    };
}

// The circle memory (quickLayers) is by the first code of the group. The first code of the topo map changed from Tt to
// Of (design openfreemap-default-basemap): otherwise the layer remembered there would be lost, and the old key would
// stay in the storage forever
const RENAMED_QUICK_KEYS: Readonly<Record<string, string>> = { Tt: 'Of' };

function renameQuickKeys(memory: Record<string, string>): Record<string, string> {
    const renamed = { ...memory };
    for (const [from, to] of Object.entries(RENAMED_QUICK_KEYS)) {
        if (from in renamed) {
            renamed[to] ??= renamed[from];
            delete renamed[from];
        }
    }
    return renamed;
}

// leafletLayersSettings of the old client: {layers: [{code, isCustom, enabled, hotkey}]} (saveSettings in
// leaflet.control.layers.configure). Codes of deleted layers are skipped; hotkey does not move: the new app has no
// layer hotkeys (owner decision, design add-web-map-layers).
function parseLegacy(raw: unknown, isKnown: (code: string) => boolean): LayerSettings | null {
    if (!isRecord(raw) || !Array.isArray(raw.layers)) {
        return null;
    }
    const settings: LayerSettings = { listed: {}, custom: [], selection: null, quickLayers: {} };
    for (const item of raw.layers) {
        if (!isRecord(item) || typeof item.code !== 'string') {
            continue;
        }
        let code: string | null = item.code;
        if (item.isCustom || isCustomLayerCode(code)) {
            code = canonicalCustomCode(code);
            if (!code || settings.custom.includes(code)) {
                continue;
            }
            settings.custom.push(code);
        } else if (!isKnown(code)) {
            continue;
        }
        if (typeof item.enabled === 'boolean') {
            settings.listed[code] = item.enabled;
        }
    }
    return settings;
}

export function loadSettings(storage: Storage | null, catalog: readonly LayerDef[]): LayerSettings {
    if (!storage) {
        return EMPTY_SETTINGS;
    }
    const known = new Set(catalog.map((layer) => layer.code));
    const byCode = new Map(catalog.map((layer) => [layer.code, layer]));
    // "unchecked" for a column group layer without isDefault in a record without groupDefaults is the previous
    // default, not a choice (StoredSettings)
    const upgrade = (listed: Record<string, boolean>) =>
        Object.fromEntries(
            Object.entries(listed).filter(
                ([code, shown]) => shown || !quickGroupOf(code) || byCode.get(code)?.isDefault !== false,
            ),
        );
    const legacy = parseLegacy(readStorage(storage, LEGACY_STORAGE_KEY), (code) => known.has(code));
    return (
        parseOwn(readStorage(storage, STORAGE_KEY), upgrade) ??
        (legacy && { ...legacy, listed: upgrade(legacy.listed) }) ??
        EMPTY_SETTINGS
    );
}

export function saveSettings(storage: Storage | null, settings: LayerSettings): void {
    const stored: StoredSettings = { version: 1, groupDefaults: true, ...settings };
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
        // the storage is full or blocked: the settings live until the reload
    }
}

// The default of the Configure layers check box: the user added a custom layer personally; a column group layer is in
// the group menu (quick-layers.ts), and the check box is its place there (design custom-bases-in-list); for the rest,
// isDefault of the catalog
export function listedByDefault(layer: LayerDef): boolean {
    return isCustomLayerCode(layer.code) || quickGroupOf(layer.code) !== undefined || layer.isDefault;
}

export function isListed(layer: LayerDef, settings: LayerSettings): boolean {
    return settings.listed[layer.code] ?? listedByDefault(layer);
}
