import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleMapsUrl, googleStreetView, loadGoogleMaps, resetGoogleMapsLoader } from './google';

// The loader and the wrapper of the Maps JavaScript API on fake document, window and google.maps (unit, Node): the
// tests do not go to Google. Only production checks the real markup of the window.

afterEach(() => {
    resetGoogleMapsLoader();
    vi.unstubAllGlobals();
});

function fakeDocument() {
    const scripts: { src: string; async: boolean; onerror: (() => void) | null; remove: () => void }[] = [];
    const doc = {
        createElement: () => {
            const script = { src: '', async: false, onerror: null as (() => void) | null, remove: vi.fn() };
            return script;
        },
        head: { append: (script: (typeof scripts)[number]) => scripts.push(script) },
    };
    return { doc: doc as unknown as Document, scripts };
}

class FakePanorama {
    static last: FakePanorama;
    position: { lat: number; lng: number } | null = null;
    pov = { heading: 0, pitch: 0 };
    zoom = 1;
    visible = true;
    listeners = new Map<string, () => void>();
    options: Record<string, unknown>;
    constructor(_container: unknown, options: Record<string, unknown>) {
        FakePanorama.created += 1;
        this.options = options;
        FakePanorama.last = this;
    }
    getPosition() {
        const position = this.position;
        return position && { lat: () => position.lat, lng: () => position.lng };
    }
    setPosition(position: { lat: number; lng: number }) {
        this.position = position;
        this.listeners.get('position_changed')?.();
    }
    getPov() {
        return this.pov;
    }
    setPov(pov: { heading: number; pitch: number }) {
        this.pov = pov;
        this.listeners.get('pov_changed')?.();
    }
    getZoom() {
        return this.zoom;
    }
    setZoom(zoom: number) {
        this.zoom = zoom;
        this.listeners.get('zoom_changed')?.();
    }
    setVisible(visible: boolean) {
        this.visible = visible;
    }
    addListener(event: string, handler: () => void) {
        this.listeners.set(event, handler);
    }
    static created = 0;
}

function fakeMaps(found: { lat: number; lng: number } | null) {
    const requests: unknown[] = [];
    return {
        requests,
        maps: {
            StreetViewPanorama: FakePanorama,
            StreetViewService: class {
                getPanorama(request: unknown, callback: (data: unknown, status: string) => void) {
                    requests.push(request);
                    callback(
                        found ? { location: { latLng: { lat: () => found.lat, lng: () => found.lng } } } : null,
                        found ? 'OK' : 'ZERO_RESULTS',
                    );
                }
            },
            StreetViewPreference: { NEAREST: 'nearest' },
            StreetViewStatus: { OK: 'OK' },
            event: { trigger: vi.fn(), clearInstanceListeners: vi.fn() },
        },
    };
}

describe('загрузка Maps JavaScript API', () => {
    it('адрес старого клиента с пустым ключом и колбэком', () => {
        expect(googleMapsUrl('')).toBe(
            'https://maps.googleapis.com/maps/api/js?v=3&key=&callback=__trailroutineGoogleMapsReady',
        );
        expect(googleMapsUrl('AIza x')).toContain('key=AIza%20x');
    });

    it('один скрипт на страницу; колбэк отдаёт google.maps', async () => {
        const { doc, scripts } = fakeDocument();
        const win = {} as Record<string, unknown>;
        const first = loadGoogleMaps('', doc, win as never);
        const second = loadGoogleMaps('', doc, win as never);
        expect(scripts).toHaveLength(1);
        expect(scripts[0].src).toBe(googleMapsUrl(''));
        win.google = { maps: fakeMaps(null).maps };
        (win.__trailroutineGoogleMapsReady as () => void)();
        expect(await first).toBe((win.google as { maps: unknown }).maps);
        expect(await second).toBe(await first);
    });

    it('скрипт не ответил за 20 с — ошибка', async () => {
        vi.useFakeTimers();
        const { doc } = fakeDocument();
        const loading = loadGoogleMaps('', doc, {} as never);
        const result = expect(loading).rejects.toThrow('failed to load');
        await vi.advanceTimersByTimeAsync(20_000);
        await result;
        vi.useRealTimers();
    });

    it('ошибка загрузки — исключение, следующая попытка — новый скрипт', async () => {
        const { doc, scripts } = fakeDocument();
        const win = {} as Record<string, unknown>;
        const first = loadGoogleMaps('', doc, win as never);
        scripts[0].onerror?.();
        await expect(first).rejects.toThrow('Maps JavaScript API failed to load');
        expect(scripts[0].remove).toHaveBeenCalled();
        void loadGoogleMaps('', doc, win as never).catch(() => {});
        expect(scripts).toHaveLength(2);
    });

    it('колбэк без google.maps — ошибка', async () => {
        const { doc } = fakeDocument();
        const win = {} as Record<string, unknown>;
        const loading = loadGoogleMaps('', doc, win as never);
        (win.__trailroutineGoogleMapsReady as () => void)();
        await expect(loading).rejects.toThrow();
    });
});

describe('Street View на Google', () => {
    it('поиск: ближайшая панорама в радиусе', async () => {
        const fake = fakeMaps({ lat: 41.6931, lng: 44.7801 });
        vi.stubGlobal('window', { google: { maps: fake.maps } });
        const api = googleStreetView('');
        expect(await api.findPanorama({ lat: 41.693, lng: 44.78 }, 30)).toEqual({ lat: 41.6931, lng: 44.7801 });
        expect(fake.requests).toEqual([{ location: { lat: 41.693, lng: 44.78 }, radius: 30, preference: 'nearest' }]);
    });

    it('ZERO_RESULTS — null', async () => {
        vi.stubGlobal('window', { google: { maps: fakeMaps(null).maps } });
        expect(await googleStreetView('').findPanorama({ lat: 1, lng: 1 }, 30)).toBeNull();
    });

    it('окно: класс режима без ключа, вид, события, destroy', async () => {
        const fake = fakeMaps(null);
        vi.stubGlobal('window', { google: { maps: fake.maps } });
        vi.stubGlobal('document', { createElement: () => fakeElement() });
        const container = { append: vi.fn() } as unknown as HTMLElement;
        const changes: unknown[] = [];
        const viewer = await googleStreetView('').createViewer(container, { onChange: (view) => changes.push(view) });
        const element = (container.append as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(element.classList.contains('google-street-view-keyless')).toBe(true);
        expect(FakePanorama.last.options).toMatchObject({ imageDateControl: true, motionTracking: false });
        viewer.show({ lat: 41.693, lng: 44.78, heading: 90, pitch: 5, zoom: 2 });
        expect(changes.at(-1)).toEqual({ lat: 41.693, lng: 44.78, heading: 90, pitch: 5, zoom: 2 });
        viewer.destroy();
        expect(element.remove).toHaveBeenCalled();
        FakePanorama.last.setPov({ heading: 10, pitch: 0 });
        expect(changes.at(-1)).toMatchObject({ heading: 90 });
        expect(FakePanorama.last.visible).toBe(false);
    });

    it('окно одно на страницу: новое включение режима берёт прежнее, старый владелец его не трогает', async () => {
        vi.stubGlobal('window', { google: { maps: fakeMaps(null).maps } });
        vi.stubGlobal('document', { createElement: () => fakeElement() });
        const created = FakePanorama.created;
        const api = googleStreetView('AIza');
        const first = await api.createViewer({ append: vi.fn() } as unknown as HTMLElement, { onChange: () => {} });
        const secondChanges: unknown[] = [];
        const secondContainer = { append: vi.fn() } as unknown as HTMLElement;
        const second = await api.createViewer(secondContainer, { onChange: (view) => secondChanges.push(view) });
        expect(FakePanorama.created - created).toBe(1);
        const element = (secondContainer.append as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(element.classList.contains('google-street-view-keyless')).toBe(false);
        // a stale owner (StrictMode, the mode is off) does not hide or move the window
        first.destroy();
        first.show({ lat: 1, lng: 1, heading: 0, pitch: 0, zoom: 1 });
        expect(element.remove).not.toHaveBeenCalled();
        second.show({ lat: 2, lng: 2, heading: 0, pitch: 0, zoom: 1 });
        expect(secondChanges.at(-1)).toMatchObject({ lat: 2, lng: 2 });
    });

    it('поиск без ответа — ошибка по таймауту', async () => {
        vi.useFakeTimers();
        const maps = {
            ...fakeMaps(null).maps,
            StreetViewService: class {
                getPanorama() {}
            },
        };
        vi.stubGlobal('window', { google: { maps } });
        const search = googleStreetView('').findPanorama({ lat: 1, lng: 1 }, 30);
        const result = expect(search).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(10_000);
        await result;
        vi.useRealTimers();
    });
});

// the div of the window: only what google.ts touches
function fakeElement() {
    const classes = new Set<string>();
    return {
        style: {},
        remove: vi.fn(),
        classList: {
            toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
            contains: (name: string) => classes.has(name),
        },
    };
}
