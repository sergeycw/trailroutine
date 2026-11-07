import { parseTrackColor } from './color';
import { loadFromUrl } from './import-url';
import { type GeoData, geoData, TRACK_COLORS, type TrackColor, type Waypoint } from './model';
import { decodeBase64Url, parseNktk, parseNktkSequence } from './nktk';
import { fetchOrNull, type TrackSources } from './sources';

// Tracks from the address parameters of the old client (NakarteUrlLoader in services/nakarte/index.js): nktk is track
// strings, nktl is storage keys, nktu is encoded links, nktp is a point, nktj is base64 JSON (loadTracksFromJson.js).

export const TRACK_PARAMS = ['nktk', 'nktl', 'nktu', 'nktp', 'nktj'] as const;
export type TrackParam = (typeof TRACK_PARAMS)[number];

export function isTrackParam(key: string): key is TrackParam {
    return (TRACK_PARAMS as readonly string[]).includes(key);
}

async function fromStorage(keys: readonly string[], sources: TrackSources): Promise<GeoData[]> {
    // requests to the storage go without credentials: the Worker reflects Origin anyway
    // (design add-web-tracks, «`nktk` и ссылки старого клиента»)
    const responses = await Promise.all(
        keys.map((key) => fetchOrNull(sources, `${sources.tracksStorageServer}/track/${key}`)),
    );
    if (responses.some((response) => !response?.ok)) {
        return [geoData('Track from nakarte server', { error: 'NETWORK' })];
    }
    const texts = await Promise.all(responses.map((response) => (response as Response).text()));
    return texts.flatMap(parseNktkSequence);
}

function point(values: readonly string[]): GeoData[] {
    const [latText, lngText, nameText] = values.map((value) => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    });
    const lat = Number.parseFloat(latText ?? '');
    const lng = Number.parseFloat(lngText ?? '');
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return [geoData('Point in url', { error: 'CORRUPT' })];
    }
    const name = (nameText ?? '').trim() || 'Point';
    return [geoData(name, { points: [{ name, lat, lng }] })];
}

interface JsonTrack {
    n?: unknown;
    u?: unknown;
    t?: unknown;
    p?: unknown;
    c?: unknown;
    v?: unknown;
    m?: unknown;
}

const CORRUPT_JSON = (): GeoData[] => [geoData('Track in url', { error: 'CORRUPT' })];

function jsonSegments(raw: unknown): GeoData['segments'] | null {
    if (!Array.isArray(raw) || raw.length === 0) {
        return null;
    }
    const segments: GeoData['segments'] = [];
    for (const rawSegment of raw) {
        if (!Array.isArray(rawSegment) || rawSegment.length === 0) {
            return null;
        }
        const segment = [];
        for (const rawPoint of rawSegment) {
            if (!Array.isArray(rawPoint) || rawPoint.length !== 2) {
                return null;
            }
            const [lat, lng] = rawPoint.map(Number);
            if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90) {
                return null;
            }
            segment.push({ lat, lng });
        }
        segments.push(segment);
    }
    return segments;
}

function jsonPoint(raw: unknown): Waypoint | null {
    const { n: name, lt, ln } = (raw ?? {}) as { n?: unknown; lt?: unknown; ln?: unknown };
    const lat = Number(lt);
    const lng = Number(ln);
    if (typeof name !== 'string' || !name || Number.isNaN(lat) || Number.isNaN(lng)) {
        return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }
    return { name, lat, lng };
}

// Field c: a palette index, as in the old client (a string too; a fractional index passes and gives a color in a
// cycle in addTracks), or a custom '#rrggbb' (design track-color-picker); null means corrupt
function jsonColor(value: unknown): TrackColor | null {
    if (typeof value === 'string' && value.startsWith('#')) {
        return parseTrackColor(value);
    }
    const number = Number(value);
    return number >= 0 && number < TRACK_COLORS.length ? number : null;
}

// Any corrupt part makes the whole parameter CORRUPT, as in the old client
async function fromJson(value: string, sources: TrackSources): Promise<GeoData[]> {
    const bytes = decodeBase64Url(value);
    if (!bytes) {
        return CORRUPT_JSON();
    }
    let text: string;
    try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        // not UTF-8: as it is, one character per byte
        text = String.fromCharCode(...bytes);
    }
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return CORRUPT_JSON();
    }
    if (!Array.isArray(data) || data.length === 0) {
        return CORRUPT_JSON();
    }
    const result: GeoData[] = [];
    for (const item of data as JsonTrack[]) {
        // each item has a link or at least segments or points
        if (!item || (!item.u && !(item.p || item.t))) {
            return CORRUPT_JSON();
        }
        let tracks: GeoData[];
        if (item.u) {
            tracks = await loadFromUrl(String(item.u), sources);
            if (item.n && tracks.length === 1 && !tracks[0].error) {
                tracks[0].name = String(item.n);
            }
        } else {
            const track = geoData(item.n ? String(item.n) : 'Track');
            if (item.t) {
                const segments = jsonSegments(item.t);
                if (!segments) {
                    return CORRUPT_JSON();
                }
                track.segments = segments;
            }
            if (item.p) {
                const points = Array.isArray(item.p) ? item.p.map(jsonPoint) : [null];
                if (points.some((p) => p === null)) {
                    return CORRUPT_JSON();
                }
                track.points = points as Waypoint[];
            }
            tracks = [track];
        }
        if ('c' in item) {
            const color = jsonColor(item.c);
            if (color === null) {
                return CORRUPT_JSON();
            }
            for (const track of tracks) {
                track.color = color;
            }
        }
        for (const track of tracks) {
            if ('v' in item) {
                track.hidden = !item.v;
            }
            if ('m' in item) {
                track.measureTicksShown = Boolean(item.m);
            }
        }
        result.push(...tracks);
    }
    return result;
}

async function fromUrls(values: readonly string[], sources: TrackSources): Promise<GeoData[]> {
    const loaded = await Promise.all(
        values.map((value) => {
            let url: string;
            try {
                url = decodeURIComponent(value);
            } catch {
                return [geoData(value, { error: 'INVALID_URL' })];
            }
            return loadFromUrl(url, sources);
        }),
    );
    return loaded.flat();
}

export async function loadTrackParam(
    key: TrackParam,
    values: readonly string[],
    sources: TrackSources,
): Promise<GeoData[]> {
    switch (key) {
        case 'nktk':
            return values.flatMap(parseNktk);
        case 'nktl':
            return fromStorage(values, sources);
        case 'nktu':
            return fromUrls(values, sources);
        case 'nktp':
            return point(values);
        case 'nktj':
            return (await Promise.all(values.map((value) => fromJson(value, sources)))).flat();
    }
}
