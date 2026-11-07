import type { AutosaveStorage } from '@/autosave/autosave';
import { SAVED_VERSION, type SavedSet } from '@/autosave/saved';
import type { Config } from '@/config';
import { formatHash, parseHash, withParam } from '@/state/hash';
import { isMoveValue, MOVE_TIMEOUT_MS } from './move-out';
import { openPayload } from './payload';

// trailroutine.com takes the data that the old address moved (change move-to-trailroutine-domain, spec clone-hosting,
// «Import of moved data»). It runs in main.tsx before the app renders: the tracks go into IndexedDB before the
// autosave restore reads it, so they appear as saved tracks with no new code in the store.

// storage keys of the moves already imported here: the same move value does not add the tracks twice
export const MOVED_IN_KEY = 'nakarte-web:moved-in';
export const MOVE_FAILED = 'Could not move tracks from nakarte-routing.pages.dev';

export interface MoveInDeps {
    location: Pick<Location, 'pathname' | 'search' | 'hash'>;
    history: Pick<History, 'replaceState' | 'state'>;
    // document.referrer: settings move only when the page came from the old address (design «Settings only from the
    // old address»): a link from any other site may add tracks, like nktl=, but must not set custom layers
    referrer: string;
    config: Pick<Config, 'movedFromHosts' | 'tracksStorageServer'>;
    storage: Pick<AutosaveStorage, 'load' | 'save'>;
    localStorage: Storage | null;
    fetch: typeof fetch;
}

function importedKeys(localStorage: Storage | null): string[] {
    try {
        const value: unknown = JSON.parse(localStorage?.getItem(MOVED_IN_KEY) ?? '[]');
        return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
    } catch {
        return [];
    }
}

function fromOldAddress(referrer: string, hosts: readonly string[]): boolean {
    try {
        return hosts.includes(new URL(referrer).hostname);
    } catch {
        return false;
    }
}

// null — nothing to import or the import is done; a string — the text of the toast about a failed import
export async function moveIn(deps: MoveInDeps): Promise<string | null> {
    const params = parseHash(deps.location.hash);
    if (!params.has('move')) {
        return null;
    }
    // the move value must not stay in the address or in the history
    const rest = formatHash(withParam(params, 'move', null));
    const url = `${deps.location.pathname}${deps.location.search}${rest ? `#${rest}` : ''}`;
    deps.history.replaceState(deps.history.state, '', url);
    const value = params.get('move')?.[0];
    if (!isMoveValue(value)) {
        return MOVE_FAILED;
    }
    const [key, secret] = value.split('.');
    const imported = importedKeys(deps.localStorage);
    if (imported.includes(key)) {
        return null;
    }
    try {
        const response = await deps.fetch(`${deps.config.tracksStorageServer}/track/${key}`, {
            signal: AbortSignal.timeout(MOVE_TIMEOUT_MS),
        });
        if (!response.ok) {
            throw new Error(`track storage responded with ${response.status}`);
        }
        const payload = await openPayload(await response.text(), secret);
        const own = (await deps.storage.load()) as SavedSet | null | undefined;
        const tracks = own?.version === SAVED_VERSION && Array.isArray(own.tracks) ? own.tracks : [];
        await deps.storage.save({ version: SAVED_VERSION, tracks: [...tracks, ...payload.tracks] });
        if (fromOldAddress(deps.referrer, deps.config.movedFromHosts)) {
            for (const [setting, text] of Object.entries(payload.settings)) {
                if (deps.localStorage?.getItem(setting) === null) {
                    deps.localStorage.setItem(setting, text);
                }
            }
        }
        deps.localStorage?.setItem(MOVED_IN_KEY, JSON.stringify([...imported, key]));
        return null;
    } catch (error) {
        console.warn('trailroutine: could not import the moved data', error);
        return MOVE_FAILED;
    }
}
