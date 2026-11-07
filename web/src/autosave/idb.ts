import type { AutosaveStorage } from './autosave';
import type { SavedSet } from './saved';

// The autosave storage in IndexedDB (design add-web-autosave): our own database on the origin that we share with the
// old client. This module does not open its database sessions: legacy-session.ts reads it one time and does not
// change it (design switch-to-web-app). One record with the key tracks in the object store autosave.

export const AUTOSAVE_DB = 'nakarte-web';
const STORE = 'autosave';
const KEY = 'tracks';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        // transaction.error is set only on abort, and abort comes after a request error
        transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
    });
}

// factory is a parameter for the tests; by default, the global indexedDB (an access to it can itself throw
// SecurityError when the site storage is blocked; this is an error of load, not a crash of the app)
export function indexedDbStorage(name = AUTOSAVE_DB, factory?: () => IDBFactory): AutosaveStorage {
    let opened: Promise<IDBDatabase> | null = null;

    function open(): Promise<IDBDatabase> {
        opened ??= new Promise<IDBDatabase>((resolve, reject) => {
            const request = (factory ? factory() : indexedDB).open(name, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE);
            request.onsuccess = () => {
                const db = request.result;
                // a different tab with a new database version: close, so that the upgrade of that tab does not wait
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error(`IndexedDB ${name} is blocked by another tab`));
        });
        return opened;
    }

    return {
        async load() {
            const db = await open();
            return requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY));
        },
        async save(record: SavedSet) {
            const db = await open();
            const transaction = db.transaction(STORE, 'readwrite');
            transaction.objectStore(STORE).put(record, KEY);
            await transactionDone(transaction);
        },
    };
}
