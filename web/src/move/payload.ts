import { fromSaved, SAVED_VERSION, type SavedTrack } from '@/autosave/saved';

// The data that moves from the old address to trailroutine.com (change move-to-trailroutine-domain, design
// «Payload»): the saved tracks of the old origin and its settings. The text is gzip, then AES-GCM with a random key.
// The ciphertext goes to the track storage; the key goes only into the URL fragment, which the server never sees.

export const MOVE_VERSION = 1;

// localStorage keys that move: the own keys of the app and the keys of the old client that the app still reads
// (settings.ts, locate.ts, activity.ts). Values move as strings, and each reader parses its key defensively.
export const MOVED_SETTINGS = [
    'nakarte-web:layers',
    'nakarte-web:position',
    'nakarte-web:routing-activity',
    'nakarte-web:recent-colors',
    'leafletLayersSettings',
    'leaflet_locate_position',
    'trackListRoutingActivity',
] as const;

export interface MovePayload {
    tracks: SavedTrack[];
    settings: Record<string, string>;
}

export class MoveError extends Error {}

type SettingsStorage = Pick<Storage, 'getItem'>;

export function readSettings(storage: SettingsStorage | null): Record<string, string> {
    const settings: Record<string, string> = {};
    for (const key of MOVED_SETTINGS) {
        try {
            const value = storage?.getItem(key);
            if (typeof value === 'string') {
                settings[key] = value;
            }
        } catch {
            // storage of the site is blocked: nothing to move
        }
    }
    return settings;
}

function toJson(payload: MovePayload): string {
    // JSON writes a float64 exactly, so coordinates do not change on the way
    return JSON.stringify({
        v: MOVE_VERSION,
        tracks: payload.tracks.map((track) => ({ ...track, segments: track.segments.map((line) => Array.from(line)) })),
        settings: payload.settings,
    });
}

const isNumbers = (value: unknown): value is number[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'number');

// A track that the autosave reader would drop (fromSaved) is dropped here too, so no broken record reaches IndexedDB.
function fromJson(text: string): MovePayload {
    const value = JSON.parse(text) as { v?: unknown; tracks?: unknown; settings?: unknown } | null;
    if (value?.v !== MOVE_VERSION || !Array.isArray(value.tracks)) {
        throw new MoveError('unknown payload');
    }
    const tracks: SavedTrack[] = [];
    for (const raw of value.tracks as Partial<Record<keyof SavedTrack, unknown>>[]) {
        if (!raw || !Array.isArray(raw.segments) || !raw.segments.every(isNumbers)) {
            continue;
        }
        const track = {
            name: raw.name,
            color: raw.color,
            visible: raw.visible,
            measureTicksShown: raw.measureTicksShown,
            segments: raw.segments.map((line: number[]) => Float64Array.from(line)),
            points: raw.points,
            routes: raw.routes,
        } as SavedTrack;
        if (fromSaved({ version: SAVED_VERSION, tracks: [track] })?.length) {
            tracks.push(track);
        }
    }
    const settings: Record<string, string> = {};
    const source = (typeof value.settings === 'object' && value.settings) || {};
    for (const key of MOVED_SETTINGS) {
        const setting = (source as Record<string, unknown>)[key];
        if (typeof setting === 'string') {
            settings[key] = setting;
        }
    }
    return { tracks, settings };
}

// btoa takes a binary string; String.fromCharCode in chunks keeps the call stack small on a 2 MB payload
function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]*$/u.test(text)) {
        throw new MoveError('not base64url');
    }
    const binary = atob(text.replace(/-/gu, '+').replace(/_/gu, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

const IV_BYTES = 12;

// body — text for the track storage (base64url of iv + ciphertext), secret — base64url of the AES key
export async function sealPayload(payload: MovePayload): Promise<{ body: string; secret: string }> {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const data = await pipe(new TextEncoder().encode(toJson(payload)), new CompressionStream('gzip'));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
    const joined = new Uint8Array(IV_BYTES + sealed.length);
    joined.set(iv);
    joined.set(sealed, IV_BYTES);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    return { body: toBase64Url(joined), secret: toBase64Url(raw) };
}

// Any damage (wrong key, cut text, foreign object) is a MoveError: AES-GCM checks the integrity itself
export async function openPayload(body: string, secret: string): Promise<MovePayload> {
    try {
        const joined = fromBase64Url(body);
        const key = await crypto.subtle.importKey('raw', fromBase64Url(secret), 'AES-GCM', false, ['decrypt']);
        const data = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: joined.slice(0, IV_BYTES) },
            key,
            joined.slice(IV_BYTES),
        );
        const text = new TextDecoder().decode(await pipe(new Uint8Array(data), new DecompressionStream('gzip')));
        return fromJson(text);
    } catch (error) {
        throw error instanceof MoveError ? error : new MoveError(String(error));
    }
}
