import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore } from '@/state/store';
import { geoData } from '@/tracks/model';
import { type AutosaveStorage, startAutosave } from './autosave';
import { fromSaved, type SavedSet, toSaved } from './saved';

const LINE = [
    { lat: 41.69, lng: 44.78 },
    { lat: 41.7, lng: 44.79 },
];

function appStore() {
    return createAppStore({
        catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base: 'O', overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// An in-memory storage: the read and each write wait until the test releases them
function manualStorage() {
    const load = deferred<unknown>();
    const saves: { record: SavedSet; done: ReturnType<typeof deferred<void>> }[] = [];
    const storage: AutosaveStorage = {
        load: () => load.promise,
        save: (record) => {
            const done = deferred<void>();
            saves.push({ record, done });
            return done.promise;
        },
    };
    const names = (i: number) => fromSaved(saves[i].record)?.map((track) => track.name);
    return { storage, load, saves, names };
}

const tick = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => {
    vi.restoreAllMocks();
});

describe('восстановление', () => {
    test('Список после перезагрузки: сохранённые треки встают в начало, вид не меняется', async () => {
        const store = appStore();
        const { storage, load } = manualStorage();
        const autosave = startAutosave(store, storage);
        load.resolve(toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 4, visible: false }]));
        await autosave.restored;
        const [track] = store.getState().tracks;
        expect(track).toMatchObject({ name: 'Saved', color: 4, visible: false, segments: [LINE] });
        expect(store.getState().boundsRequest).toBeNull();
        expect(store.getState().viewRequest).toBeNull();
    });

    test('трек, созданный до конца чтения, остаётся после сохранённых и записывается', async () => {
        const store = appStore();
        const { storage, load, saves, names } = manualStorage();
        const autosave = startAutosave(store, storage);
        store.getState().addTracks([geoData('New track', { segments: [LINE] })]);
        await tick();
        expect(saves).toHaveLength(0);
        load.resolve(toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]));
        await autosave.restored;
        expect(store.getState().tracks.map((track) => track.name)).toEqual(['Saved', 'New track']);
        expect(saves).toHaveLength(1);
        expect(names(0)).toEqual(['Saved', 'New track']);
    });

    test('восстановление без изменений ничего не пишет', async () => {
        const store = appStore();
        const { storage, load, saves } = manualStorage();
        const autosave = startAutosave(store, storage);
        load.resolve(toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]));
        await autosave.restored;
        await tick();
        expect(saves).toHaveLength(0);
    });

    test('Хранилище недоступно: приложение работает, записи нет, одно предупреждение', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = appStore();
        const { storage, load, saves } = manualStorage();
        const autosave = startAutosave(store, storage);
        load.reject(new Error('denied'));
        await autosave.restored;
        store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        autosave.flush();
        await tick();
        expect(saves).toHaveLength(0);
        expect(store.getState().tracks).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    test('испорченная запись: предупреждение, импорт не ждёт вечно, сохранение работает', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const store = appStore();
        const { storage, load, saves } = manualStorage();
        const autosave = startAutosave(store, storage);
        const saved = toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]);
        load.resolve({ ...saved, tracks: [{ ...saved.tracks[0], routes: [{ waypoints: [0, 1], legs: [null] }] }] });
        await autosave.restored;
        expect(store.getState().tracks.map((track) => track.name)).toEqual(['Saved']);
        expect(store.getState().tracks[0].routes).toBeUndefined();
        store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        expect(saves).toHaveLength(1);
    });

    test('чтение не отвечает: треки из адреса отпускаются по таймауту, сохранённые потом встают в начало', async () => {
        const store = appStore();
        const { storage, load, saves } = manualStorage();
        const autosave = startAutosave(store, storage, 10);
        await autosave.restored;
        store.getState().addTracks([geoData('From link', { segments: [LINE] })]);
        expect(saves).toHaveLength(0);
        load.resolve(toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]));
        await tick();
        expect(store.getState().tracks.map((track) => track.name)).toEqual(['Saved', 'From link']);
        expect(saves).toHaveLength(1);
    });

    test('второй запуск на том же сторе (Fast Refresh) не читает и не задваивает список', async () => {
        const store = appStore();
        const first = manualStorage();
        const autosave = startAutosave(store, first.storage);
        first.load.resolve(
            toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]),
        );
        await autosave.restored;
        autosave.stop();
        const second = manualStorage();
        const again = startAutosave(store, second.storage);
        await again.restored;
        expect(store.getState().tracks).toHaveLength(1);
        store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        expect(second.saves).toHaveLength(1);
    });

    test('остановленное до конца чтения автосохранение треков не добавляет (Strict Mode)', async () => {
        const store = appStore();
        const { storage, load } = manualStorage();
        const autosave = startAutosave(store, storage);
        autosave.stop();
        load.resolve(toSaved([{ id: 'x', name: 'Saved', segments: [LINE], points: [], color: 0, visible: true }]));
        await autosave.restored;
        expect(store.getState().tracks).toHaveLength(0);
    });
});

describe('запись', () => {
    async function started() {
        const store = appStore();
        const manual = manualStorage();
        const autosave = startAutosave(store, manual.storage);
        manual.load.resolve(undefined);
        await autosave.restored;
        return { store, autosave, ...manual };
    }

    test('изменение пишется сразу, без таймера', async () => {
        const { store, saves, names } = await started();
        store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        expect(saves).toHaveLength(1);
        expect(names(0)).toEqual(['a']);
    });

    test('пока запись в полёте, изменения уходят одной записью последнего состояния', async () => {
        const { store, saves, names } = await started();
        const [a] = store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        store.getState().updateTrack(a.id, { name: 'b' });
        store.getState().updateTrack(a.id, { name: 'c' });
        expect(saves).toHaveLength(1);
        saves[0].done.resolve();
        await tick();
        expect(saves).toHaveLength(2);
        expect(names(1)).toEqual(['c']);
        saves[1].done.resolve();
        await tick();
        expect(saves).toHaveLength(2);
    });

    test('ошибка записи не останавливает следующие', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { store, saves } = await started();
        const [a] = store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        saves[0].done.reject(new Error('quota'));
        await tick();
        store.getState().updateTrack(a.id, { name: 'b' });
        expect(saves).toHaveLength(2);
    });

    test('Удалённый трек: запись без него', async () => {
        const { store, saves, names } = await started();
        const [a] = store
            .getState()
            .addTracks([geoData('a', { segments: [LINE] }), geoData('b', { segments: [LINE] })]);
        saves[0].done.resolve();
        await tick();
        store.getState().removeTracks([a.id]);
        expect(names(1)).toEqual(['b']);
    });

    test('pagehide: несохранённое пишется сразу, не дожидаясь текущей записи', async () => {
        const { store, autosave, saves, names } = await started();
        const [a] = store.getState().addTracks([geoData('a', { segments: [LINE] })]);
        store.getState().updateTrack(a.id, { name: 'b' });
        autosave.flush();
        expect(saves).toHaveLength(2);
        expect(names(1)).toEqual(['b']);
        // after the current write, there is nothing to repeat
        saves[0].done.resolve();
        await tick();
        expect(saves).toHaveLength(2);
    });

    test('без изменений pagehide ничего не пишет; правки вне треков не пишутся', async () => {
        const { store, autosave, saves } = await started();
        store.getState().setRoutingActivity('hiking');
        autosave.flush();
        expect(saves).toHaveLength(0);
    });
});

// Spec tracks, «Сохранённые сессии старого клиента не трогаются»: the source legacy is the last session of the old
// client
describe('сессия старого клиента', () => {
    test('Сессия старого клиента: без своей записи треки сессии в списке и сразу пишутся своей записью', async () => {
        const store = appStore();
        const { storage, load, saves, names } = manualStorage();
        const legacy = vi.fn(async () => [geoData('From old client', { segments: [LINE] })]);
        const autosave = startAutosave(store, { ...storage, legacy });
        load.resolve(undefined);
        await autosave.restored;
        expect(legacy).toHaveBeenCalledOnce();
        expect(store.getState().tracks.map((track) => track.name)).toEqual(['From old client']);
        expect(saves).toHaveLength(1);
        expect(names(0)).toEqual(['From old client']);
    });

    test('Свой список уже есть: источник не спрашивается, даже если список пуст', async () => {
        const store = appStore();
        const { storage, load, saves } = manualStorage();
        const legacy = vi.fn(async () => [geoData('From old client', { segments: [LINE] })]);
        const autosave = startAutosave(store, { ...storage, legacy });
        load.resolve(toSaved([]));
        await autosave.restored;
        expect(legacy).not.toHaveBeenCalled();
        expect(store.getState().tracks).toEqual([]);
        expect(saves).toHaveLength(0);
    });

    test('пустой трек сессии остаётся, как у старого клиента', async () => {
        const store = appStore();
        const { storage, load } = manualStorage();
        const autosave = startAutosave(store, { ...storage, legacy: async () => [geoData('New track')] });
        load.resolve(undefined);
        await autosave.restored;
        expect(store.getState().tracks.map((track) => track.name)).toEqual(['New track']);
    });

    test('источник упал — пустой список, предупреждение, сохранение работает', async () => {
        const store = appStore();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { storage, load, saves, names } = manualStorage();
        const autosave = startAutosave(store, { ...storage, legacy: () => Promise.reject(new Error('blocked')) });
        load.resolve(undefined);
        await autosave.restored;
        expect(store.getState().tracks).toEqual([]);
        expect(warn).toHaveBeenCalledOnce();
        expect(saves).toHaveLength(0);
        store.getState().addTracks([geoData('New track', { segments: [LINE] })]);
        await tick();
        expect(names(0)).toEqual(['New track']);
    });

    test('разметка сессии проходит упрощение ссылки: опорные точки на месте', async () => {
        const store = appStore();
        const { storage, load } = manualStorage();
        const routed = [LINE[0], { lat: 41.695, lng: 44.785 }, { lat: 41.69501, lng: 44.78501 }, LINE[1]];
        const legacy = async () => [
            geoData('Routed', {
                segments: [routed],
                routes: [{ waypoints: [0, 3], legs: [{ state: 'routed' as const, activity: 'hiking' }] }],
            }),
        ];
        const autosave = startAutosave(store, { ...storage, legacy });
        load.resolve(undefined);
        await autosave.restored;
        const [track] = store.getState().tracks;
        expect(track.segments[0][0]).toEqual(LINE[0]);
        expect(track.segments[0].at(-1)).toEqual(LINE[1]);
        expect(track.routes?.[0]?.legs).toEqual([{ state: 'routed', activity: 'hiking' }]);
    });
});
