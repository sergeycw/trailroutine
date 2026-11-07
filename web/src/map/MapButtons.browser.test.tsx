import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { config } from '@/config';
import { P } from '@/test/map-events';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { POSITION_KEY } from './locate';

// The map buttons in App (spec web-client: «Где я», «Последнее положение при заходе»,
// «Масштаб на карте», «Атрибуция карты»). The test replaces the browser geolocation for its duration: the real one in
// headless mode would ask for permission.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    // the own property is removed, so the real navigator.geolocation of the prototype comes back
    Reflect.deleteProperty(navigator, 'geolocation');
    vi.restoreAllMocks();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

interface FakeAnswer {
    position?: { lat: number; lng: number; accuracy: number };
    error?: { code: number; message: string };
}

// A replaced geolocation: it answers watchPosition and getCurrentPosition at once with the given position or error
function fakeGeolocation(answer: FakeAnswer) {
    const calls = { watch: 0, current: 0 };
    const respond = (success: PositionCallback, failure?: PositionErrorCallback | null) => {
        setTimeout(() => {
            if (answer.position) {
                const { lat, lng, accuracy } = answer.position;
                success({
                    coords: { latitude: lat, longitude: lng, accuracy } as GeolocationCoordinates,
                    timestamp: Date.now(),
                } as GeolocationPosition);
            } else if (answer.error) {
                failure?.({
                    ...answer.error,
                    PERMISSION_DENIED: 1,
                    POSITION_UNAVAILABLE: 2,
                    TIMEOUT: 3,
                } as GeolocationPositionError);
            }
        }, 10);
    };
    const geolocation = {
        watchPosition: (success: PositionCallback, failure?: PositionErrorCallback | null) => {
            calls.watch += 1;
            respond(success, failure);
            return 1;
        },
        getCurrentPosition: (success: PositionCallback, failure?: PositionErrorCallback | null) => {
            calls.current += 1;
            respond(success, failure);
        },
        clearWatch: () => {},
    };
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
    return calls;
}

const near = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.abs(a.lat - b.lat) < 1e-3 && Math.abs(a.lng - b.lng) < 1e-3;

describe('Где я', () => {
    test('Положение получено', async () => {
        fakeGeolocation({ position: { lat: 41.7, lng: 44.8, accuracy: 30 } });
        const { map } = await renderApp(tiles, '#m=10/41/44&l=O');
        await page.getByRole('button', { name: 'Find my location' }).click();
        // MapLibre flies to the position with the flyTo animation
        await expect.poll(() => near(map.getCenter(), P(41.7, 44.8)), { timeout: 5000 }).toBe(true);
        await expect.poll(() => document.querySelector('.maplibregl-user-location-dot')).not.toBeNull();
        expect(document.querySelector('.maplibregl-user-location-accuracy-circle')).not.toBeNull();
        // the position is remembered for the next visit
        expect(JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null')).toEqual({ lat: 41.7, lng: 44.8 });
    });

    test('Геолокация запрещена', async () => {
        fakeGeolocation({ error: { code: 1, message: 'User denied Geolocation' } });
        localStorage.setItem(POSITION_KEY, '{"lat":41.7,"lng":44.8}');
        await renderApp(tiles, '#m=10/41/44&l=O');
        await page.getByRole('button', { name: 'Find my location' }).click();
        await expect
            .element(page.getByText('Geolocation is blocked for this site. Please, enable in browser setting.'))
            .toBeVisible();
        expect(localStorage.getItem(POSITION_KEY)).toBe('null');
    });

    test('прочая ошибка — текст браузера', async () => {
        fakeGeolocation({ error: { code: 3, message: 'Timeout expired' } });
        await renderApp(tiles, '#m=10/41/44&l=O');
        await page.getByRole('button', { name: 'Find my location' }).click();
        await expect.element(page.getByText('Geolocation error: Timeout expired')).toBeVisible();
    });
});

describe('Вид кнопки геолокации', () => {
    // the token color as getComputedStyle gives it: a test element with the same background
    function tokenColor(token: string) {
        const probe = document.createElement('div');
        probe.style.backgroundColor = `var(${token})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
    }
    const button = () => page.getByRole('button', { name: 'Find my location' });
    const icon = () => {
        const element = button().element().querySelector('.maplibregl-ctrl-icon');
        if (!element) {
            throw new Error('нет значка');
        }
        return getComputedStyle(element);
    };

    test('Слежение включено', async () => {
        fakeGeolocation({ position: { lat: 41.7, lng: 44.8, accuracy: 30 } });
        await renderApp(tiles, '#m=10/41/44&l=O');
        await button().click();
        await expect.element(button()).toHaveClass('maplibregl-ctrl-geolocate-active');
        expect(getComputedStyle(button().element()).backgroundColor).toBe(tokenColor('--primary'));
        expect(icon().backgroundColor).toBe(tokenColor('--primary-foreground'));
        // the icon shape is a mask: without it, a white square would show instead of the icon
        expect(icon().backgroundImage).toBe('none');
        expect(icon().maskImage).toContain('data:image/svg+xml');
    });

    test('Слежение в фоне', async () => {
        fakeGeolocation({ position: { lat: 41.7, lng: 44.8, accuracy: 30 } });
        const { map } = await renderApp(tiles, '#m=10/41/44&l=O');
        await button().click();
        // tracking starts with the browser answer: before the flight to the position, a map move does not change the
        // state
        await expect.poll(() => near(map.getCenter(), P(41.7, 44.8)), { timeout: 5000 }).toBe(true);
        await expect.element(button()).not.toHaveClass('maplibregl-ctrl-geolocate-waiting');
        // a map move that does not come from geolocation sends tracking to the background
        map.panBy([100, 0], { duration: 0 });
        await expect.element(button()).toHaveClass('maplibregl-ctrl-geolocate-background');
        expect(getComputedStyle(button().element()).backgroundColor).not.toBe(tokenColor('--primary'));
        expect(icon().backgroundColor).toBe(tokenColor('--primary'));
    });
});

describe('Последнее положение при заходе', () => {
    test('Заход с запомненным положением', async () => {
        // the browser answers with another position a bit later: the map moves to it
        const calls = fakeGeolocation({ position: { lat: 41.8, lng: 44.9, accuracy: 30 } });
        localStorage.setItem(POSITION_KEY, '{"lat":41.69,"lng":44.78}');
        const { map } = await renderApp(tiles, '');
        expect(calls.current).toBe(1);
        await expect.poll(() => near(map.getCenter(), P(41.8, 44.9))).toBe(true);
        // the default zoom is the same as for the initial view (config.ts)
        expect(map.getZoom()).toBe(config.defaultZoom);
    });

    test('без ответа браузера — запомненное положение', async () => {
        fakeGeolocation({});
        localStorage.setItem(POSITION_KEY, '{"lat":41.69,"lng":44.78}');
        const { map } = await renderApp(tiles, '');
        expect(near(map.getCenter(), P(41.69, 44.78))).toBe(true);
    });

    test('Заход по ссылке с видом', async () => {
        const calls = fakeGeolocation({ position: { lat: 41.8, lng: 44.9, accuracy: 30 } });
        localStorage.setItem(POSITION_KEY, '{"lat":41.69,"lng":44.78}');
        const { map } = await renderApp(tiles, '#m=13/42.68490/47.07008&l=O');
        expect(near(map.getCenter(), P(42.6849, 47.07008))).toBe(true);
        expect(calls.current).toBe(0);
    });

    test('без запомненного положения браузер не спрашивается', async () => {
        const calls = fakeGeolocation({ position: { lat: 41.8, lng: 44.9, accuracy: 30 } });
        await renderApp(tiles, '');
        expect(calls.current).toBe(0);
    });
});

describe('Масштаб на карте', () => {
    test('Линейка масштаба', async () => {
        await renderApp(tiles, '#m=13/42.68490/47.07008&l=O');
        await expect.element(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
        expect(document.querySelector('.maplibregl-ctrl-scale')?.textContent).toMatch(/\d+\s?(m|km)/u);
        // there is no number between the zoom buttons: the capsule has only "+" and "−"
        const zoom = document.querySelector('.maplibregl-ctrl-zoom-in')?.parentElement;
        expect(zoom?.textContent).toBe('');
    });
});

describe('Атрибуция карты', () => {
    const attribution = () => document.querySelector('.maplibregl-ctrl-attrib');
    const expanded = () => attribution()?.classList.contains('maplibregl-compact-show') ?? false;

    test('Сворачивание по первому движению карты', async () => {
        const { map } = await renderApp(tiles, '#m=13/42.68490/47.07008&l=O');
        // expanded at the start: the layer attribution is visible without clicks
        await expect.element(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
        expect(expanded()).toBe(true);
        // a programmatic move (the view from the address, tracks, geolocation) does not collapse it
        map.jumpTo({ center: [47.1, 42.7] });
        expect(expanded()).toBe(true);
        // a zoom by the button is a user move, not only the drag on which MapLibre itself collapses it
        await page.getByRole('button', { name: 'Zoom in' }).click();
        await expect.poll(expanded).toBe(false);
        // collapsed: the attribution is not visible, only the (i) button; getByRole does not find a link under
        // display: none (MapLibre hides the block with a class, <details> stays open), so the check uses the DOM
        expect(attribution()?.querySelector('.maplibregl-ctrl-attrib-inner')?.checkVisibility()).toBe(false);
        // the (i) button expands it again
        await page.getByTitle('Toggle attribution').click();
        await expect.poll(expanded).toBe(true);
        await expect.element(page.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
    });
});
