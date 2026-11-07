import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore } from '@/state/store';
import { geoData, type LatLng } from '@/tracks/model';
import { createElevationProfile } from './controller';

// The profile follows the track (spec tracks, «Профиль следует за треком», «Ошибка сервиса высот в профиле») on a
// store without the map: the elevation API is a stub fetch, the time is fake timers

const line = (lat: number): LatLng[] => [
    { lat, lng: 44.78 },
    { lat: lat + 0.009, lng: 44.78 },
];

function setup(respond: (body: string) => Response | Promise<Response> = heights) {
    const store = createAppStore({
        catalog: buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' }),
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base: 'O', overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
    });
    const bodies: string[] = [];
    const messages: string[] = [];
    const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = String(init?.body);
        bodies.push(body);
        return respond(body);
    }) as typeof globalThis.fetch;
    const profile = createElevationProfile({
        store,
        source: { fetch, url: 'https://elevation.test/' },
        notify: (title) => messages.push(title),
    });
    const stop = profile.start();
    const [track] = store.getState().addTracks([geoData('Walk', { segments: [line(41.7), line(41.75)] })]);
    const state = () => store.getState();
    return { store, state, profile, stop, track, bodies, messages };
}

// the elevation is the latitude × 100
function heights(body: string) {
    return new Response(
        body
            .split('\n')
            .map((row) => (Number.parseFloat(row) * 100).toFixed(2))
            .join('\n'),
    );
}

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('открытие', () => {
    test('профиль трека: один запрос по обоим отрезкам', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id);
        expect(state().profile).toEqual({ trackId: track.id, segment: null });
        expect(state().profileData?.updating).toBe(true);
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(1);
        const data = state().profileData;
        expect(data?.updating).toBe(false);
        expect(data?.samples.starts).toHaveLength(2);
        expect(data?.values?.[0]).toBe(4170);
    });

    test('профиль отрезка — только его точки', async () => {
        const { state, profile, track } = setup();
        profile.open(track.id, 1);
        await vi.runAllTimersAsync();
        expect(state().profileData?.samples.starts).toEqual([0]);
        expect(state().profileData?.values?.[0]).toBe(4175);
    });

    test('Трек без линий', () => {
        const { store, state, profile, bodies, messages } = setup();
        const [empty] = store.getState().addTracks([geoData('Points', { points: [{ lat: 1, lng: 1, name: 'a' }] })]);
        profile.open(empty.id);
        expect(state().profile).toBeNull();
        expect(messages).toEqual(['Track is empty']);
        expect(bodies).toEqual([]);
    });
});

describe('Профиль следует за треком', () => {
    test('изменение линий — перестроение после паузы одним запросом, прежний профиль виден', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id);
        await vi.runAllTimersAsync();
        const before = state().profileData;
        state().updateTrack(track.id, { segments: [line(41.6), line(41.75)] });
        state().updateTrack(track.id, { segments: [line(41.5), line(41.75)] });
        await vi.advanceTimersByTimeAsync(900);
        expect(bodies).toHaveLength(1);
        // the previous graph with an indicator while the pause continues
        expect(state().profileData?.values).toBe(before?.values);
        expect(state().profileData?.updating).toBe(true);
        // synchronous: an asynchronous step would also wait for the API answer
        vi.advanceTimersByTime(100);
        expect(state().profileData?.updating).toBe(true);
        expect(state().profileData?.values).toBe(before?.values);
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(2);
        expect(state().profileData?.values?.[0]).toBe(4150);
    });

    test('ожидающий отрезок — ждать ответа роутера', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id, 0);
        await vi.runAllTimersAsync();
        state().updateTrack(track.id, {
            segments: [line(41.6), line(41.75)],
            routes: [{ waypoints: [0, 1], legs: [{ state: 'pending', activity: 'hiking' }] }, null],
        });
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(1);
        state().updateTrack(track.id, {
            segments: [line(41.6), line(41.75)],
            routes: [{ waypoints: [0, 1], legs: [{ state: 'routed', activity: 'hiking' }] }, null],
        });
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(2);
    });

    test('профиль отрезка не перестраивается от правки другого отрезка', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id, 0);
        await vi.runAllTimersAsync();
        // this is how the editor writes: a new array of segments, and a segment that did not change keeps the same
        // reference
        const [first] = state().tracks[0].segments;
        state().updateTrack(track.id, { segments: [first, line(41.8)] });
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(1);
        expect(state().profileData?.updating).toBe(false);
    });

    test('цвет, название, видимость — без перестроения', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id);
        await vi.runAllTimersAsync();
        state().updateTrack(track.id, { color: 3, name: 'Run', visible: false });
        await vi.runAllTimersAsync();
        expect(bodies).toHaveLength(1);
    });

    test('Удаление трека', async () => {
        const { state, profile, track } = setup();
        profile.open(track.id);
        await vi.runAllTimersAsync();
        state().removeTracks([track.id]);
        expect(state().profile).toBeNull();
        expect(state().profileData).toBeNull();
    });

    test('профиль отрезка закрывается при смене числа отрезков, профиль трека перестраивается', async () => {
        const { state, profile, track, bodies } = setup();
        profile.open(track.id, 1);
        await vi.runAllTimersAsync();
        state().updateTrack(track.id, { segments: [line(41.75)] });
        expect(state().profile).toBeNull();
        profile.open(track.id);
        await vi.runAllTimersAsync();
        state().updateTrack(track.id, { segments: [line(41.75), line(41.8), line(41.9)] });
        await vi.runAllTimersAsync();
        expect(state().profile).not.toBeNull();
        expect(state().profileData?.samples.starts).toHaveLength(3);
        expect(bodies).toHaveLength(3);
    });

    test('устаревший ответ отбрасывается', async () => {
        let release: (() => void) | null = null;
        const { state, profile, track } = setup(async (body) => {
            if (release === null) {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
            }
            return heights(body);
        });
        profile.open(track.id, 0);
        await vi.advanceTimersByTimeAsync(0);
        profile.open(track.id, 1);
        await vi.runAllTimersAsync();
        expect(state().profileData?.values?.[0]).toBe(4175);
        (release as unknown as () => void)();
        await vi.runAllTimersAsync();
        expect(state().profileData?.values?.[0]).toBe(4175);
    });
});

describe('Ошибка сервиса высот в профиле', () => {
    test('Сервис недоступен: ошибка с причиной, Retry строит профиль', async () => {
        let fail = true;
        const { state, profile, track } = setup((body) => {
            if (fail) {
                throw new TypeError('Failed to fetch');
            }
            return heights(body);
        });
        profile.open(track.id);
        await vi.runAllTimersAsync();
        expect(state().profileData).toMatchObject({ error: 'network error', values: null, updating: false });
        fail = false;
        profile.retry();
        await vi.runAllTimersAsync();
        expect(state().profileData).toMatchObject({ error: null, updating: false });
        expect(state().profileData?.values).toHaveLength(state().profileData?.samples.points.length ?? -1);
    });

    test('Слишком частые запросы', async () => {
        const { state, profile, track } = setup(() => new Response('', { status: 429 }));
        profile.open(track.id);
        await vi.runAllTimersAsync();
        expect(state().profileData?.error).toBe('too many requests, try again in a minute');
    });

    test('ошибка перестроения оставляет прежний график', async () => {
        let fail = false;
        const { state, profile, track } = setup((body) => {
            if (fail) {
                return new Response('', { status: 500 });
            }
            return heights(body);
        });
        profile.open(track.id);
        await vi.runAllTimersAsync();
        const values = state().profileData?.values;
        fail = true;
        state().updateTrack(track.id, { segments: [line(41.6)] });
        await vi.runAllTimersAsync();
        expect(state().profileData).toMatchObject({ error: 'HTTP 500', values });
    });
});
