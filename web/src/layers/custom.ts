import { CUSTOM_BOTTOM_ORDER, CUSTOM_TOP_ORDER, type LayerDef, viaCorsProxy } from './catalog';

// Custom layers of the user. The code format is the same as in the old client (serializeCustomLayer and
// loadCustomLayerFromString in src/lib/leaflet.control.layers.configure/index.js): `-cs` + URL-safe base64 of the JSON
// of the form fields, non-ASCII through \uXXXX. The JSON keys are in the same order, so both clients read a link with
// a custom layer, and a comparison of the codes finds duplicates. The old client ignores the new field corsProxy (it
// loads the tiles with <img> without CORS).

export interface CustomLayerFields {
    name: string;
    url: string;
    tms: boolean;
    // only printing in the old client needed it; the new form does not have it, old codes keep it as it was
    scaleDependent: boolean;
    maxZoom: number;
    isOverlay: boolean;
    // above or under the built-in overlays; not important for a basemap
    isTop: boolean;
    corsProxy?: boolean;
}

const CODE_PREFIX = '-cs';

export function isCustomLayerCode(code: string): boolean {
    return code.startsWith(CODE_PREFIX);
}

export function serializeCustomLayer(fields: CustomLayerFields): string {
    const { corsProxy, ...rest } = fields;
    const json = JSON.stringify(corsProxy ? { ...rest, corsProxy: true } : rest).replace(
        /[\u007f-￿]/gu,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    return CODE_PREFIX + btoa(json).replace(/\+/gu, '-').replace(/\//gu, '_');
}

export function parseCustomLayerCode(code: string): CustomLayerFields | null {
    if (!isCustomLayerCode(code)) {
        return null;
    }
    let raw: unknown;
    try {
        raw = JSON.parse(atob(code.slice(CODE_PREFIX.length).replace(/-/gu, '+').replace(/_/gu, '/')));
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const fields = raw as Partial<CustomLayerFields>;
    if (typeof fields.url !== 'string' || typeof fields.name !== 'string') {
        return null;
    }
    // the key order stays (spread of the source object), so a second serialization gives the same code;
    // isTop without a value is a code from before this field, the old client treated it as "above" (upgrade in
    // loadCustomLayerFromString)
    return { ...fields, isTop: fields.isTop ?? true } as CustomLayerFields;
}

// SAS Planet tokens of the old CustomLayer: MapLibre substitutes only its own tokens, and transformRequest gets a ready
// address without z/x/y; their support would need an own load protocol (design, «Свои слои»)
const UNSUPPORTED_TOKENS = ['{z_1}', '{x_1024}', '{y_1024}'];

export function unsupportedTokens(url: string): string[] {
    return UNSUPPORTED_TOKENS.filter((token) => url.includes(token));
}

interface TileTemplates {
    tiles: string[];
    scheme: 'xyz' | 'tms';
}

// Leaflet template → MapLibre tokens: {s} → addresses by the subdomains abc (the L.TileLayer default), {r} → {ratio},
// {-y} (inverted y) and the tms flag → scheme: 'tms'
export function tileTemplates(fields: CustomLayerFields, corsProxyUrl: string): TileTemplates {
    const flipped = fields.url.includes('{-y}');
    const template = fields.url.replaceAll('{-y}', '{y}').replaceAll('{r}', '{ratio}');
    const urls = template.includes('{s}') ? [...'abc'].map((s) => template.replaceAll('{s}', s)) : [template];
    return {
        tiles: fields.corsProxy ? urls.map((url) => viaCorsProxy(corsProxyUrl, url)) : urls,
        scheme: fields.tms || flipped ? 'tms' : 'xyz',
    };
}

export function customLayerDef(code: string, fields: CustomLayerFields, corsProxyUrl: string): LayerDef {
    const { tiles, scheme } = tileTemplates(fields, corsProxyUrl);
    return {
        code,
        title: fields.name,
        group: 'Custom layers',
        // the places of custom layers in the stacking order are #custom-top and #custom-bottom of the old catalog
        order: fields.isOverlay && fields.isTop ? CUSTOM_TOP_ORDER : CUSTOM_BOTTOM_ORDER,
        isOverlay: fields.isOverlay,
        isDefault: false,
        source: { type: 'raster', tiles, scheme, tileSize: 256, maxzoom: fields.maxZoom },
    };
}

// The address of one tile at the view center, for the CORS check. zoom is the MapLibre map zoom; 256 px tiles at it
// have the zoom floor(zoom + 1), not deeper than the layer maxZoom.
export function probeTileUrl(
    fields: CustomLayerFields,
    center: { lat: number; lng: number },
    zoom: number,
    corsProxyUrl: string,
): string {
    const { tiles, scheme } = tileTemplates(fields, corsProxyUrl);
    const z = Math.max(0, Math.min(Math.floor(zoom + 1), fields.maxZoom));
    const n = 2 ** z;
    const lat = Math.max(-85.05, Math.min(85.05, center.lat));
    const x = Math.min(n - 1, Math.floor((((((center.lng + 180) % 360) + 360) % 360) / 360) * n));
    const latRad = (lat * Math.PI) / 180;
    const y = Math.min(n - 1, Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n));
    return tiles[0]
        .replaceAll('{z}', String(z))
        .replaceAll('{x}', String(x))
        .replaceAll('{y}', String(scheme === 'tms' ? n - 1 - y : y))
        .replaceAll('{ratio}', '');
}

export type CorsCheck = 'ok' | 'no-cors' | 'unreachable';

// The CORS request passed: the server allows reading (even 404: the center can have no tile). It failed, but no-cors
// returned an answer: the server is alive but without CORS, so the form offers the proxy. no-cors failed too: the
// server is unreachable (or http:// from an https:// page).
export async function checkCors(url: string, fetchImpl: typeof fetch = fetch): Promise<CorsCheck> {
    try {
        await fetchImpl(url, { mode: 'cors' });
        return 'ok';
    } catch {
        // no-cors is below
    }
    try {
        await fetchImpl(url, { mode: 'no-cors' });
        return 'no-cors';
    } catch {
        return 'unreachable';
    }
}
