// The address of the new app in the format of the old client (src/lib/leaflet.hashState/hashState.js): `#k=v1/v2&k2`:
// `&` separates pairs, `/` separates values, a key without `=` is an empty list. Values are not decoded: the old client
// did not encode or decode them, and old links must be read and built back byte for byte. Parameters that the app does
// not understand (q, p, j, min, sid…) stay in their places: the user keeps them when the map moves; sync.ts parses
// tracks, r= and n2=.

export type HashParams = ReadonlyMap<string, readonly string[]>;

export function parseHash(hash: string): HashParams {
    const params = new Map<string, string[]>();
    const start = hash.indexOf('#');
    const body = (start >= 0 ? hash.slice(start + 1) : hash).trim();
    if (!body) {
        return params;
    }
    for (const pair of body.split('&')) {
        // a lazy key, as in parseHashParams: all after the first `=` is the value, `=` in base64 of custom layers stays
        const match = /^([^=]+?)(?:=(.*))?$/u.exec(pair);
        if (!match) {
            continue;
        }
        const [, key, value] = match;
        params.set(key, value ? value.split('/') : []);
    }
    return params;
}

export function formatHash(params: HashParams): string {
    const items: string[] = [];
    for (const [key, values] of params) {
        items.push(values.length ? `${key}=${values.join('/')}` : key);
    }
    return items.join('&');
}

// null removes the key; a new key goes to the end, an existing key stays in its place
export function withParam(params: HashParams, key: string, values: readonly string[] | null): HashParams {
    const next = new Map(params);
    if (values === null) {
        next.delete(key);
    } else {
        next.set(key, values);
    }
    return next;
}

export interface View {
    lat: number;
    lng: number;
    // MapLibre zoom: its world at z0 is 512 px, the Leaflet world is 256 px, so the same scale is 1 less
    zoom: number;
}

// m=zoom/lat/lng with the zoom of the old client. The checks are validateState of the old Leaflet.Map.js; the zoom is
// read as fractional, because the new app writes it as fractional (the old client reads it with parseInt).
export function parseView(values: readonly string[] | undefined): View | null {
    if (values?.length !== 3) {
        return null;
    }
    const [zoom, lat, lng] = values.map(Number.parseFloat);
    if ([zoom, lat, lng].some(Number.isNaN) || zoom < 0 || zoom > 32 || lat < -90 || lat > 90) {
        return null;
    }
    return { lat, lng, zoom: Math.max(0, zoom - 1) };
}

export function formatView({ lat, lng, zoom }: View): string[] {
    const leafletZoom = Math.round((zoom + 1) * 100) / 100;
    return [String(leafletZoom), lat.toFixed(5), lng.toFixed(5)];
}
