import type { AppStore } from '@/state/store';
import { prepareImport } from '@/tracks/import-result';
import type { GeoData } from '@/tracks/model';
import { fromSaved, type SavedSet, toSaved } from './saved';

// Autosave of the working set (design add-web-autosave): the code writes the tab tracks with the route markup to the
// storage on each change of tracks in the store, and restores them at the start. No timer: a write starts at once,
// and while it is in progress, the changes collect as a "dirty" flag and go as one write of the last state after it.
// So a series of edits gives not more than one write per commit, and a single edit does not wait for a debounce
// window in which a reload can occur. A write on pagehide during a reload can fail to finish, so flush is only a
// backup.

export interface AutosaveStorage {
    // the record as it is, or undefined if there is no record; an error means the storage is not available
    load(): Promise<unknown>;
    save(record: SavedSet): Promise<void>;
    // where to get the list if there is no record of our own yet: the last session of the old client (design
    // switch-to-web-app, «Сессия старого клиента: последняя, один раз»). The code writes the taken list as our own
    // record at once, so it does not ask the source a second time.
    legacy?(): Promise<GeoData[]>;
}

export interface Autosave {
    // the restore finished, failed or did not fit in RESTORE_TIMEOUT_MS: after it, the code can add tracks from the
    // address and from files. It never rejects.
    restored: Promise<void>;
    // write the unsaved changes now, without waiting for the current write (pagehide, the tab went to the background)
    flush(): void;
    stop(): void;
}

// How long to wait for the read before the code lets in the tracks from the address and from files: sometimes
// IndexedDB answers with neither success nor error, and then a link would never open. The restored tracks go to the
// start of the list also after this time.
export const RESTORE_TIMEOUT_MS = 3000;

// The code restores a store one time: Fast Refresh in dev restarts the effects of App with a live store, and a second
// read would double the list. Strict Mode does not come here: its first instance stops before the read ends.
const restoredStores = new WeakSet<AppStore>();

export function startAutosave(
    store: AppStore,
    storage: AutosaveStorage,
    restoreTimeoutMs = RESTORE_TIMEOUT_MS,
): Autosave {
    // writes start only after the restore: otherwise the first write of an empty store would overwrite the saved data
    let enabled = false;
    let stopped = false;
    let dirty = false;
    let inFlight = false;
    let warned = false;

    function warn(error: unknown) {
        if (!warned) {
            warned = true;
            console.warn('trailroutine: tracks are not saved between reloads', error);
        }
    }

    function write() {
        dirty = false;
        return storage.save(toSaved(store.getState().tracks)).catch(warn);
    }

    function next() {
        if (stopped || inFlight || !dirty) {
            return;
        }
        inFlight = true;
        write().finally(() => {
            inFlight = false;
            next();
        });
    }

    const unsubscribe = store.subscribe((state, prev) => {
        if (enabled && state.tracks !== prev.tracks) {
            dirty = true;
            next();
        }
    });

    // imported means the tracks are not from our own record (a session of the old client): write them as our own
    // record at once
    function restore(read: () => GeoData[] | null, imported = false) {
        if (stopped) {
            return;
        }
        // the list changed before the read ended (New track): write it after the restore
        let changed = store.getState().tracks !== tracksAtStart;
        try {
            const saved = read();
            if (saved?.length) {
                store.getState().addTracks(saved, true);
                changed ||= imported;
            }
        } catch (error) {
            // a corrupted record must not break the app or turn off the saves: the next write replaces it
            warn(error);
        }
        restoredStores.add(store);
        enabled = true;
        dirty = changed;
        next();
    }

    async function load() {
        const value = await storage.load();
        if (value !== undefined || !storage.legacy) {
            restore(() => fromSaved(value));
            return;
        }
        // there is no record of our own: the list of the old client goes the same way as a link (simplification with
        // waypoints), and empty tracks stay, as when the old client restored a session (loadTracksFromString with
        // allowEmpty)
        const legacy = await storage.legacy().catch((error: unknown) => {
            warn(error);
            return [];
        });
        restore(() => prepareImport(legacy, true).tracks, true);
    }

    const tracksAtStart = store.getState().tracks;
    let read: Promise<void>;
    if (restoredStores.has(store)) {
        enabled = true;
        read = Promise.resolve();
    } else {
        read = load().catch(warn);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restored = Promise.race([
        read,
        new Promise<void>((resolve) => {
            timer = setTimeout(resolve, restoreTimeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));

    return {
        restored,
        flush() {
            // IndexedDB runs readwrite transactions on one store in the order of creation, so a second write in
            // parallel with the current one does not overtake it
            if (enabled && !stopped && dirty) {
                void write();
            }
        },
        stop() {
            stopped = true;
            unsubscribe();
        },
    };
}
