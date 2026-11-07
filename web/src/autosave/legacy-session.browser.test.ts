import { afterEach, expect, test } from 'vitest';
import { readLatestLegacySession } from './legacy-session';

// The real IndexedDB of Chromium in the schema of the database sessions of the old client (src/lib/session-state at
// commit 015be893): object store sessionData, keyPath sessionId, index mtime. Each test has its own database name.

const names: string[] = [];

function uniqueName() {
    const name = `sessions-test-${crypto.randomUUID()}`;
    names.push(name);
    return name;
}

function deleteDb(name: string) {
    return new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

afterEach(async () => {
    await Promise.all(names.splice(0).map(deleteDb));
});

// SessionRepository of the old client: openDB(name, 1) with the object store and the index, put({sessionId, mtime,
// data})
function writeLegacySessions(name: string, records: { sessionId: string; mtime: number; data: unknown }[]) {
    return new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore('sessionData', { keyPath: 'sessionId' });
            store.createIndex('mtime', 'mtime', { unique: false });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('sessionData', 'readwrite');
            for (const record of records) {
                transaction.objectStore('sessionData').put(record);
            }
            transaction.oncomplete = () => {
                db.close();
                resolve();
            };
            transaction.onabort = () => reject(transaction.error);
        };
    });
}

test('последняя по mtime сессия с треками', async () => {
    const name = uniqueName();
    await writeLegacySessions(name, [
        { sessionId: 'a', mtime: 1000, data: { hash: '#', tracks: 'OLD', trackNames: ['old'] } },
        { sessionId: 'b', mtime: 3000, data: { hash: '#', tracks: '', trackNames: [] } },
        { sessionId: 'c', mtime: 2000, data: { hash: '#', tracks: 'NEW', trackNames: ['new'], routeMarkup: null } },
    ]);
    expect(await readLatestLegacySession(indexedDB, name)).toEqual({
        hash: '#',
        tracks: 'NEW',
        trackNames: ['new'],
        routeMarkup: null,
    });
});

test('базы нет — undefined, и база не создаётся', async () => {
    const name = uniqueName();
    expect(await readLatestLegacySession(indexedDB, name)).toBeUndefined();
    const databases = await indexedDB.databases();
    expect(databases.map((db) => db.name)).not.toContain(name);
});

test('база без сессий — undefined', async () => {
    const name = uniqueName();
    await writeLegacySessions(name, []);
    expect(await readLatestLegacySession(indexedDB, name)).toBeUndefined();
});
