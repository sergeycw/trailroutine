import { describe, expect, test } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore } from '@/state/store';
import { createTrackActions, nextPointName, pointCoordinates } from './actions';
import type { ExportedFile } from './export';
import { geoData, type Waypoint } from './model';

// Track points through the list actions without a map (spec tracks, «Добавление точек трека», «Меню точки трека»)

function setup(writeClipboard: (text: Promise<string>) => Promise<void> = async () => {}) {
    const store = createAppStore({
        catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base: 'O', overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
    });
    const messages: string[] = [];
    const actions = createTrackActions({
        store,
        sources: { fetch: globalThis.fetch, corsProxyUrl: '', tracksStorageServer: '', elevationsServer: '' },
        notify: (title) => messages.push(title),
        location: () => ({ origin: '', pathname: '', hash: '' }),
        writeClipboard,
    });
    const [track] = store.getState().addTracks([geoData('Walk', { hidden: true })]);
    const points = () => store.getState().tracks[0].points;
    return { store, actions, track, points, messages };
}

const named = (...names: string[]): Waypoint[] => names.map((name) => ({ lat: 0, lng: 0, name }));

describe('nextPointName', () => {
    test('Номер после наибольшего', () => {
        expect(nextPointName(named('003', 'Spring'))).toBe('004');
        expect(nextPointName(named('005', '002'))).toBe('006');
    });

    test('первый номер, номер с суффиксом, не номер', () => {
        expect(nextPointName([])).toBe('001');
        expect(nextPointName(named('007 camp'))).toBe('008');
        expect(nextPointName(named('1234', '12.5', '42'))).toBe('001');
    });

    test('после 999 — пустое', () => {
        expect(nextPointName(named('999'))).toBe('');
    });
});

describe('Добавление точек трека', () => {
    test('Поставить две точки: номера по порядку, трек становится видимым, окно названия открыто', () => {
        const { store, actions, track, points } = setup();
        actions.startAddPoint(track);
        expect(store.getState().tracks[0].visible).toBe(true);
        expect(store.getState().pointTool).toEqual({ kind: 'add', trackId: track.id });
        const first = actions.addPoint(track.id, { lat: 41.69, lng: 44.78 });
        expect(store.getState().pointDialog).toEqual({ trackId: track.id, point: first });
        actions.addPoint(track.id, { lat: 41.7, lng: 404.79 });
        // the longitude goes into ±180, as latlng.wrap() of the old client
        expect(points()).toEqual([
            { lat: 41.69, lng: 44.78, name: '001' },
            { lat: 41.7, lng: expect.closeTo(44.79), name: '002' },
        ]);
        actions.stopPointTool();
        expect(store.getState().pointTool).toBeNull();
    });
});

describe('Меню точки трека', () => {
    test('Переименовать точку, пустое название допустимо', () => {
        const { actions, track, points } = setup();
        const point = actions.addPoint(track.id, { lat: 41.69, lng: 44.78 }) as Waypoint;
        actions.renamePoint(track.id, point, 'Pass');
        expect(points()[0].name).toBe('Pass');
        actions.renamePoint(track.id, points()[0], '');
        expect(points()[0].name).toBe('');
    });

    test('Переместить точку: режим заканчивается', () => {
        const { store, actions, track, points } = setup();
        const point = actions.addPoint(track.id, { lat: 41.69, lng: 44.78 }) as Waypoint;
        actions.startMovePoint(track.id, point);
        actions.movePoint(track.id, point, { lat: 41.7, lng: 44.8 });
        expect(points()).toEqual([{ lat: 41.7, lng: 44.8, name: '001' }]);
        expect(store.getState().pointTool).toBeNull();
    });

    test('Удалить точку; пропавшая точка — ничего', () => {
        const { actions, track, points } = setup();
        const first = actions.addPoint(track.id, { lat: 41.69, lng: 44.78 }) as Waypoint;
        actions.addPoint(track.id, { lat: 41.7, lng: 44.79 });
        actions.removePoint(track.id, first);
        expect(points().map((point) => point.name)).toEqual(['002']);
        actions.removePoint(track.id, first);
        actions.renamePoint(track.id, first, 'Gone');
        expect(points().map((point) => point.name)).toEqual(['002']);
    });

    test('Скопировать координаты: пять знаков, долгота в ±180', async () => {
        const copied: string[] = [];
        const { actions, messages } = setup(async (text) => {
            copied.push(await text);
        });
        expect(pointCoordinates({ lat: 41.6912345, lng: 44.7812345 })).toBe('41.69123 44.78123');
        await actions.copyPointCoordinates({ lat: 41.6912345, lng: 404.7812345 });
        expect(copied).toEqual(['41.69123 44.78123']);
        expect(messages).toEqual(['Coordinates copied']);
    });

    test('буфер не дался — окно с координатами', async () => {
        const { store, actions } = setup(() => Promise.reject(new Error('denied')));
        await actions.copyPointCoordinates({ lat: -1.5, lng: -70.25 });
        expect(store.getState().copyFallback).toEqual({ title: 'Point coordinates', text: '-1.50000 -70.25000' });
    });
});

// Spec track-files, «GPX с высотами» («Save as GPX»): API requests go to a fake fetch, the file goes to a fake write
describe('GPX с высотами', () => {
    function withElevation(fetch: typeof globalThis.fetch, elevationTimeout?: number) {
        const store = createAppStore({
            catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
            corsProxyUrl: 'https://proxy.test/',
            settings: EMPTY_SETTINGS,
            selection: { base: 'O', overlays: [] },
            view: { lat: 0, lng: 0, zoom: 1 },
        });
        const messages: string[] = [];
        const saved: ExportedFile[] = [];
        const actions = createTrackActions({
            store,
            sources: { fetch, corsProxyUrl: '', tracksStorageServer: '', elevationsServer: 'https://elevation.test/' },
            notify: (title) => messages.push(title),
            location: () => ({ origin: '', pathname: '', hash: '' }),
            save: (file) => saved.push(file),
            elevationTimeout,
        });
        return { store, actions, messages, saved };
    }
    const walk = geoData('Walk', {
        segments: [
            [
                { lat: 41.7, lng: 44.78 },
                { lat: 41.71, lng: 44.79 },
            ],
        ],
        points: [{ lat: 41.69, lng: 44.77, name: 'Camp' }],
    });

    test('Сохранить с высотами: запрос — точки трека и отрезков, индикатор загрузки на время запроса', async () => {
        const bodies: string[] = [];
        let loadingDuringRequest = 0;
        const { store, actions, saved, messages } = withElevation(async (url, init) => {
            expect(url).toBe('https://elevation.test/');
            loadingDuringRequest = store.getState().loadingTracks;
            bodies.push(String(init?.body));
            return new Response('100.00\n200.00\nNULL');
        });
        const [track] = store.getState().addTracks([walk]);
        await actions.saveGpx(track);
        expect(bodies).toEqual(['41.690000 44.770000\n41.700000 44.780000\n41.710000 44.790000']);
        expect(loadingDuringRequest).toBe(1);
        expect(store.getState().loadingTracks).toBe(0);
        expect(messages).toEqual([]);
        expect(saved[0].filename).toBe('Walk.gpx');
        expect(saved[0].content).toContain('<ele>100.0</ele>');
        expect(saved[0].content).toContain('<ele>200.0</ele><time>');
        expect(saved[0].content.match(/<ele>/gu)).toHaveLength(2);
    });

    test('Сервис недоступен', async () => {
        const { store, actions, saved, messages } = withElevation(async () => {
            throw new TypeError('Failed to fetch');
        });
        const [track] = store.getState().addTracks([walk]);
        await actions.saveGpx(track);
        // the user needs the file without the network too: the same GPX without <ele>, no message
        // (design trim-track-menus)
        expect(messages).toEqual([]);
        expect(saved.map((file) => file.filename)).toEqual(['Walk.gpx']);
        expect(saved[0].content).not.toContain('<ele>');
        expect(saved[0].content).toContain('<trkpt lat="41.700000" lon="44.780000">');
        expect(store.getState().loadingTracks).toBe(0);
    });

    test('ответ не 200 — тот же GPX без высот', async () => {
        const { store, actions, saved, messages } = withElevation(async () => new Response('', { status: 503 }));
        const [track] = store.getState().addTracks([walk]);
        await actions.saveGpx(track);
        expect(messages).toEqual([]);
        expect(saved.map((file) => file.filename)).toEqual(['Walk.gpx']);
        expect(saved[0].content).not.toContain('<ele>');
    });

    test('API высот завис — по таймауту GPX без высот', async () => {
        const hanging: typeof fetch = (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
            });
        const { store, actions, saved, messages } = withElevation(hanging, 20);
        const [track] = store.getState().addTracks([walk]);
        await actions.saveGpx(track);
        expect(messages).toEqual([]);
        expect(saved.map((file) => file.filename)).toEqual(['Walk.gpx']);
        expect(saved[0].content).not.toContain('<ele>');
        expect(store.getState().loadingTracks).toBe(0);
    });

    test('повторное нажатие, пока GPX собирается, второго файла не даёт', async () => {
        let answer!: () => void;
        const { store, actions, saved } = withElevation(
            () => new Promise((resolve) => (answer = () => resolve(new Response('1\n2\n3')))),
        );
        const [track] = store.getState().addTracks([walk]);
        const first = actions.saveGpx(track);
        await actions.saveGpx(track);
        answer();
        await first;
        expect(saved).toHaveLength(1);
    });

    test('KML — без высот и без запросов', async () => {
        let requests = 0;
        const { store, actions, saved } = withElevation(async () => {
            requests++;
            return new Response('');
        });
        const [track] = store.getState().addTracks([walk]);
        actions.saveKml(track);
        expect(requests).toBe(0);
        expect(saved.map((file) => file.filename)).toEqual(['Walk.kml']);
    });

    test('пустой трек — сообщение без запроса', async () => {
        let requests = 0;
        const { store, actions, saved, messages } = withElevation(async () => {
            requests++;
            return new Response('');
        });
        const [track] = store.getState().addTracks([geoData('Empty')]);
        await actions.saveGpx(track);
        expect(messages).toEqual(['Track is empty, nothing to save']);
        expect(requests).toBe(0);
        expect(saved).toEqual([]);
    });
});
