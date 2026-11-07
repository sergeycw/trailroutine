import type { AutosaveStorage } from '@/autosave/autosave';
import { SAVED_VERSION, type SavedSet, type SavedTrack, toSaved } from '@/autosave/saved';
import type { Config } from '@/config';
import { parseTrackColor } from '@/tracks/color';
import { prepareImport } from '@/tracks/import-result';
import { TRACK_COLORS, type Track } from '@/tracks/model';
import { storeTracks } from '@/tracks/share';
import { readSettings, sealPayload } from './payload';

// The old address moves the visitor to trailroutine.com (change move-to-trailroutine-domain, spec clone-hosting,
// «Move from the old address»). It runs in main.tsx before the app renders, so the old app never flashes and never
// writes to its storage after the move.

// The move value of the first successful move: later visits reuse it and do not upload the data again
export const MOVED_KEY = 'nakarte-web:moved';
// a request to the track storage must not keep the visitor on a blank page for long
export const MOVE_TIMEOUT_MS = 10_000;

const MOVE_VALUE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/u;

export interface MoveOutDeps {
    location: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>;
    config: Pick<Config, 'siteOrigin' | 'movedFromHosts' | 'tracksStorageServer'>;
    storage: AutosaveStorage;
    localStorage: Storage | null;
    fetch: typeof fetch;
}

export function isMoveValue(value: unknown): value is string {
    return typeof value === 'string' && MOVE_VALUE.test(value);
}

// The fragment is not parsed and built again: it goes to the new domain exactly as it came, `move` is added at the end
function target({ location, config }: MoveOutDeps, move: string | null): string {
    const raw = location.hash.replace(/^#/u, '');
    const parts = [raw, move ? `move=${move}` : ''].filter(Boolean);
    return `${config.siteOrigin}${location.pathname}${location.search}${parts.length ? `#${parts.join('&')}` : ''}`;
}

// The tracks the app would restore here: the own autosave record or, without it, the last session of the old client
// (the same choice as startAutosave)
async function savedTracks(storage: AutosaveStorage): Promise<SavedTrack[]> {
    const value = await storage.load();
    if (value !== undefined || !storage.legacy) {
        const set = value as SavedSet | null;
        return set?.version === SAVED_VERSION && Array.isArray(set.tracks) ? set.tracks : [];
    }
    // the same fields as addTracks in the store; ids do not move, the new domain gives its own
    const tracks = prepareImport(await storage.legacy(), true).tracks.map(
        (item, i): Track => ({
            id: `moved-${i}`,
            name: item.name,
            segments: item.segments,
            points: item.points,
            color: parseTrackColor(item.color) ?? i % TRACK_COLORS.length,
            visible: !item.hidden,
            measureTicksShown: item.measureTicksShown ?? false,
            ...(item.routes ? { routes: item.routes } : {}),
        }),
    );
    return toSaved(tracks).tracks;
}

function remembered(localStorage: Storage | null): string | null {
    try {
        const value = localStorage?.getItem(MOVED_KEY);
        return isMoveValue(value) ? value : null;
    } catch {
        return null;
    }
}

// The URL to go to, or null: this host does not move, or the data could not be read or stored. With null the app
// renders here as before, and the next visit tries again.
export async function moveOut(deps: MoveOutDeps): Promise<string | null> {
    if (!deps.config.movedFromHosts.includes(deps.location.hostname)) {
        return null;
    }
    const known = remembered(deps.localStorage);
    if (known) {
        return target(deps, known);
    }
    try {
        const tracks = await savedTracks(deps.storage);
        const settings = readSettings(deps.localStorage);
        if (tracks.length === 0 && Object.keys(settings).length === 0) {
            return target(deps, null);
        }
        const { body, secret } = await sealPayload({ tracks, settings });
        const key = await storeTracks(body, {
            tracksStorageServer: deps.config.tracksStorageServer,
            fetch: (input, init) => deps.fetch(input, { ...init, signal: AbortSignal.timeout(MOVE_TIMEOUT_MS) }),
        });
        const move = `${key}.${secret}`;
        deps.localStorage?.setItem(MOVED_KEY, move);
        return target(deps, move);
    } catch (error) {
        console.warn('trailroutine: could not move the data to the new domain', error);
        return null;
    }
}
