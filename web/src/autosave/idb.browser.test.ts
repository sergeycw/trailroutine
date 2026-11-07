import { afterEach, expect, test } from 'vitest';
import { indexedDbStorage } from './idb';
import { fromSaved, toSaved } from './saved';

// The real IndexedDB of Chromium: write, read with a new instance (as after a reload), storage failure. e2e checks
// that the code does not touch the database sessions of the old client («Сессия старого клиента»).

const names: string[] = [];

function uniqueName() {
    const name = `nakarte-web-test-${crypto.randomUUID()}`;
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

const LINE = [
    { lat: 41.690001234567, lng: 44.780009876543 },
    { lat: 41.7, lng: 44.79 },
];

test('пустая база — записи нет', async () => {
    expect(await indexedDbStorage(uniqueName()).load()).toBeUndefined();
});

test('запись читается новым экземпляром хранилища, Float64Array и разметка целы', async () => {
    const name = uniqueName();
    const record = toSaved([
        {
            id: 'a',
            name: 'Маршрут',
            segments: [LINE],
            routes: [{ waypoints: [0, 1], legs: [{ state: 'routed', activity: 'hiking' }] }],
            points: [],
            color: 2,
            visible: true,
        },
    ]);
    await indexedDbStorage(name).save(record);
    const loaded = await indexedDbStorage(name).load();
    expect(fromSaved(loaded)).toEqual(fromSaved(record));
    expect((loaded as typeof record).tracks[0].segments[0]).toBeInstanceOf(Float64Array);
});

test('следующая запись заменяет предыдущую', async () => {
    const name = uniqueName();
    const storage = indexedDbStorage(name);
    const track = { id: 'a', name: 'a', segments: [LINE], points: [], color: 0, visible: true };
    await Promise.all([storage.save(toSaved([track])), storage.save(toSaved([{ ...track, name: 'b' }]))]);
    expect(fromSaved(await storage.load())?.map((item) => item.name)).toEqual(['b']);
});

test('Хранилище недоступно: ошибка открытия — отказ load и save, а не исключение', async () => {
    const storage = indexedDbStorage(uniqueName(), () => {
        throw new DOMException('denied', 'SecurityError');
    });
    await expect(storage.load()).rejects.toThrow('denied');
    await expect(storage.save(toSaved([]))).rejects.toThrow('denied');
});
