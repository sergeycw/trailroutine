import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { config } from '@/config';
import { fakeRouter } from '@/test/fake-router';
import {
    chooseFromMenu,
    drag,
    editPanel,
    features,
    fire,
    idle,
    menuItems,
    newTrack,
    P,
    rightClick,
} from '@/test/map-events';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import type { LatLng, Waypoint } from '@/tracks/model';
import { saveNktk } from '@/tracks/nktk';
import { PROFILE_SELECTION } from './style';

// The elevation profile in App on a real MapLibre map (specs tracks and route-editing; design
// add-web-elevation-profile, «Тесты»): the tiles are a fixture, the elevation API is a fetch stub (the elevation is a
// function of the latitude), the router is fake. The test titles are the scenarios of the specs.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

// Tbilisi, zoom 14 of the old client: a kilometer along the meridian ≈ 330 px
const VIEW = '#m=14/41.695/44.785';
// segments along the meridian of ≈ 1 km each (0.009° of latitude), the second one ≈ 1.2 km north of the first
const SOUTH = [P(41.68, 44.78), P(41.689, 44.78)];
const NORTH = [P(41.7, 44.79), P(41.709, 44.79)];

// the elevation is (latitude − 41.6) × 10 000: 41.68 → 800 m, 41.689 → 890 m; the climb along the meridian is even
const height = (lat: number) => Math.round((lat - 41.6) * 10000 * 100) / 100;

interface Api {
    fetch: typeof fetch;
    // the bodies of the requests to the elevation API
    requests: string[];
}

// An in-memory elevation API; respond gives a custom answer for a request body (error, 429, NULL)
function elevationApi(respond?: (body: string, attempt: number) => Response | null): Api {
    const requests: string[] = [];
    const api: Api = {
        requests,
        fetch: async (input, init) => {
            if (String(input) !== config.elevationsServer) {
                throw new TypeError(`no network in tests: ${String(input)}`);
            }
            const body = String(init?.body);
            requests.push(body);
            const custom = respond?.(body, requests.length);
            if (custom) {
                return custom;
            }
            const rows = body.split('\n').map((row) => height(Number.parseFloat(row)).toFixed(2));
            return new Response(rows.join('\n'));
        },
    };
    return api;
}

function trackLink(name: string, segments: LatLng[][], points: Waypoint[] = []) {
    return `${VIEW}&nktk=${saveNktk({ name, segments, points })}`;
}

async function render(hash: string, api = elevationApi()) {
    localStorage.setItem('nakarte-web:routing-activity', 'hiking');
    const router = fakeRouter({ auto: true });
    const app = await renderApp(tiles, hash, { fetch: api.fetch, router });
    return { ...app, api, router };
}

const profilePanel = () => page.getByTestId('elevation-profile');
const stat = (key: string) => profilePanel().element().querySelector(`[data-stat="${key}"]`)?.textContent ?? '';

async function trackMenu(name: string, item: string) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function openTrackProfile(name: string) {
    await trackMenu(name, 'Show elevation profile');
    await expect.poll(() => stat('distance')).not.toBe('');
}

// the graph point at a fraction of the width: screen coordinates for synthetic pointer events
function graphAt(fraction: number) {
    const rect = page.getByTestId('profile-graph').element().getBoundingClientRect();
    return { clientX: Math.round(rect.left + (rect.width - 1) * fraction), clientY: Math.round(rect.top + 20) };
}

function pointer(type: string, fraction: number, init: PointerEventInit = {}) {
    page.getByTestId('profile-graph')
        .element()
        .dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerType: 'mouse',
                pointerId: 1,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                ...graphAt(fraction),
                ...init,
            }),
        );
}

const cursorLabel = () => page.getByTestId('profile-cursor-label').element().textContent ?? '';

// the center of the cursor marker on the map, in map coordinates
function markerAt(map: MaplibreMap) {
    const rect = page.getByTestId('profile-marker').element().getBoundingClientRect();
    const container = map.getCanvasContainer().getBoundingClientRect();
    return map.unproject([rect.left + rect.width / 2 - container.left, rect.top + rect.height / 2 - container.top]);
}

describe('Профиль высот трека и отрезка', () => {
    test('Профиль трека', async () => {
        const { api } = await render(trackLink('Walk', [SOUTH, NORTH]));
        await openTrackProfile('Walk');
        // the distance is the sum of the segments without the gap between them
        expect(stat('distance')).toBe('2.00 km');
        expect(api.requests).toHaveLength(1);
        const link = profilePanel().getByRole('link', { name: /viewfinderpanoramas/ });
        await expect.element(link).toHaveAttribute('href', config.elevationsAttribution.url);
    });

    test('Профиль отрезка', async () => {
        const { map, api } = await render(trackLink('Walk', [SOUTH, NORTH]));
        await rightClick(map, P(41.705, 44.79));
        await chooseFromMenu('Show elevation profile for segment');
        await expect.poll(() => stat('distance')).toBe('1.00 km');
        await expect.element(profilePanel().getByText('Walk, segment 2')).toBeVisible();
        expect(api.requests).toHaveLength(1);
        // the link rounds the coordinates to the nktk grid (≈ 2.4 m)
        const [lat, lng] = api.requests[0].split('\n')[0].split(' ').map(Number);
        expect(lat).toBeCloseTo(41.7, 4);
        expect(lng).toBeCloseTo(44.79, 4);
        // the edit continues, and the editor panel is above the profile
        await expect.element(editPanel()).toBeVisible();
        const editBottom = editPanel().element().getBoundingClientRect().bottom;
        expect(editBottom).toBeLessThanOrEqual(profilePanel().element().getBoundingClientRect().top);
    });

    test('Трек без линий', async () => {
        const { api } = await render(trackLink('Points', [], [{ lat: 41.69, lng: 44.78, name: 'Camp' }]));
        await trackMenu('Points', 'Show elevation profile');
        await expect.element(page.getByText('Track is empty')).toBeVisible();
        expect(profilePanel().query()).toBeNull();
        expect(api.requests).toEqual([]);
    });

    test('закрыть профиль', async () => {
        await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        // the profile button under the map closes the panel: the panel has no cross of its own
        await page.getByRole('button', { name: /^Elevation profile/ }).click();
        await expect.poll(() => profilePanel().query()).toBeNull();
    });
});

describe('Сводка профиля', () => {
    test('Подъём и спуск: стык отрезков не считается подъёмом', async () => {
        await render(trackLink('Walk', [SOUTH, NORTH]));
        await openTrackProfile('Walk');
        // 800 → 890 and 1000 → 1090: the ascent is 180 m, not 290
        expect(stat('ascent')).toBe('180 m');
        expect(stat('descent')).toBe('0 m');
        expect(stat('min')).toBe('800 m');
        expect(stat('max')).toBe('1090 m');
        expect(stat('start')).toBe('800 m');
        expect(stat('finish')).toBe('1090 m');
    });

    test('Точки без данных', async () => {
        const api = elevationApi((body) => {
            const rows = body.split('\n').map((row) => {
                const lat = Number.parseFloat(row);
                return lat > 41.684 && lat < 41.686 ? 'NULL' : height(lat).toFixed(2);
            });
            return new Response(rows.join('\n'));
        });
        await render(trackLink('Walk', [SOUTH]), api);
        await openTrackProfile('Walk');
        await expect.element(page.getByTestId('profile-note')).toHaveTextContent('Some elevation data missing');
        // the graph breaks at the points without data: two runs of the polyline
        const d = page.getByTestId('profile-line').element().getAttribute('d') ?? '';
        expect(d.match(/M/gu)).toHaveLength(2);
        // the points without data do not pull the scale to zero
        expect(stat('min')).toBe('800 m');
        expect(stat('ascent')).toBe('~90 m');
    });
});

// the first half of SOUTH is flat at 800 m, the second half (≈ 500 m) climbs 100 m: ≈ 20 %
const flatThenClimb = (lat: number) => (lat <= 41.6845 ? 800 : 800 + ((lat - 41.6845) / 0.0045) * 100);

function climbApi() {
    return elevationApi((body) => {
        const rows = body.split('\n').map((row) => flatThenClimb(Number.parseFloat(row)).toFixed(2));
        return new Response(rows.join('\n'));
    });
}

const slopeFill = (step: number) =>
    page.getByTestId('profile-graph').element().querySelector(`[data-slope="${step}"]`)?.getAttribute('d') ?? '';

describe('Раскраска профиля по крутизне', () => {
    test('Участки разной крутизны', async () => {
        await render(trackLink('Walk', [SOUTH]), climbApi());
        await openTrackProfile('Walk');
        await expect.poll(() => slopeFill(0)).not.toBe('');
        expect(slopeFill(4)).not.toBe('');
        expect(slopeFill(5)).toBe('');
        const legend = page.getByRole('img', { name: /^Slope: under 3%, 3–6%/ });
        await expect.element(legend).toBeVisible();
        await expect.element(legend).toHaveTextContent('36101525%');
    });
});

describe('Курсор профиля и карта', () => {
    test('Курсор на графике', async () => {
        const { map } = await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        pointer('pointermove', 0.5);
        await expect.element(page.getByTestId('profile-marker')).toBeVisible();
        expect(cursorLabel()).toContain('0.50 km');
        expect(cursorLabel()).toContain('845 m');
        const at = markerAt(map);
        expect(at.lat).toBeCloseTo(41.6845, 3);
        expect(at.lng).toBeCloseTo(44.78, 3);
        // React builds onPointerLeave from pointerout with a relatedTarget outside
        pointer('pointerout', 0.5, { relatedTarget: document.body });
        await expect.poll(() => page.getByTestId('profile-marker').query()).toBeNull();
    });

    test('Курсор над линией', async () => {
        const { map } = await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        await idle(map);
        fire(map, 'mousemove', SOUTH[1]);
        await expect.element(page.getByTestId('profile-cursor')).toBeVisible();
        expect(cursorLabel()).toContain('1.00 km');
        const graph = page.getByTestId('profile-graph').element().getBoundingClientRect();
        const cursor = page.getByTestId('profile-cursor').element().getBoundingClientRect();
        expect(graph.right - cursor.left).toBeLessThan(4);
        // the mouse moved away from the line, so there is no cursor
        fire(map, 'mousemove', P(41.684, 44.79));
        await expect.poll(() => page.getByTestId('profile-cursor').query()).toBeNull();
        // the line of a hidden track is not visible, so a hover on its place does not set the cursor
        await page.getByRole('checkbox', { name: 'Show Walk' }).click();
        await idle(map);
        fire(map, 'mousemove', SOUTH[1]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(page.getByTestId('profile-cursor').query()).toBeNull();
    });

    test('Выделение участка', async () => {
        const { map } = await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        pointer('pointerdown', 0.25);
        pointer('pointermove', 0.4);
        pointer('pointermove', 0.5);
        pointer('pointerup', 0.5);
        await expect.element(profilePanel().getByText('Selection')).toBeVisible();
        expect(stat('distance')).toBe('0.25 km');
        // 0.25 km of a climb of 90 m per 1 km: 22.5 m; the selection points are the nearest sample points
        expect(stat('ascent')).toMatch(/^2[23] m$/);
        await expect.poll(() => features(map, PROFILE_SELECTION).length).toBe(1);
        // the graph outside the selection is dimmed: on the left and on the right of the section
        expect(page.getByTestId('profile-dim').elements()).toHaveLength(2);
        // a click without a move removes the selection
        pointer('pointerdown', 0.7);
        pointer('pointerup', 0.7);
        await expect.poll(() => stat('distance')).toBe('1.00 km');
        await expect.poll(() => features(map, PROFILE_SELECTION).length).toBe(0);
    });

    test('Уклон у курсора', async () => {
        await render(trackLink('Walk', [SOUTH]), climbApi());
        await openTrackProfile('Walk');
        pointer('pointermove', 0.1);
        await expect.element(page.getByTestId('profile-cursor-label')).toBeVisible();
        expect(cursorLabel()).toMatch(/km0%$/u);
        pointer('pointermove', 0.9);
        await expect.poll(cursorLabel).toMatch(/km↑ 20%$/u);
    });

    test('двойной клик переводит карту в точку графика', async () => {
        const { map } = await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        const zoom = map.getZoom();
        page.getByTestId('profile-graph')
            .element()
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, ...graphAt(0) }));
        await expect.poll(() => map.getCenter().lat).toBeCloseTo(41.68, 4);
        expect(map.getCenter().lng).toBeCloseTo(44.78, 4);
        expect(map.getZoom()).toBeCloseTo(zoom, 6);
    });
});

// a finger on the graph: a touch pointer event at a fraction of the width of the graph frame (the scroller), so the
// fingers stay in place on the screen while the graph grows with the zoom
function finger(type: string, id: number, fraction: number) {
    const frame = page.getByTestId('profile-graph').element().parentElement as HTMLElement;
    const rect = frame.getBoundingClientRect();
    page.getByTestId('profile-graph')
        .element()
        .dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                cancelable: true,
                pointerType: 'touch',
                pointerId: id,
                isPrimary: id === 1,
                clientX: rect.left + (rect.width - 1) * fraction,
                clientY: rect.top + 20,
            }),
        );
}

describe('Finger gestures on the elevation profile', () => {
    test('Finger cursor', async () => {
        await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        finger('pointerdown', 1, 0.25);
        finger('pointermove', 1, 0.4);
        finger('pointermove', 1, 0.5);
        await expect.poll(cursorLabel).toContain('0.50 km');
        // the finger stays on the graph longer than a long press after the move: still no selection
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(profilePanel().getByText('Selection').query()).toBeNull();
        finger('pointerup', 1, 0.5);
        expect(stat('distance')).toBe('1.00 km');
    });

    test('Selection with a long press', async () => {
        const { map } = await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        finger('pointerdown', 1, 0.25);
        // the long press: the panel shows the selection before the move
        await expect.element(profilePanel().getByText('Selection')).toBeVisible();
        finger('pointermove', 1, 0.4);
        finger('pointermove', 1, 0.5);
        finger('pointerup', 1, 0.5);
        await expect.poll(() => stat('distance')).toBe('0.25 km');
        await expect.poll(() => features(map, PROFILE_SELECTION).length).toBe(1);
        // a tap removes the selection
        finger('pointerdown', 1, 0.7);
        finger('pointerup', 1, 0.7);
        await expect.poll(() => stat('distance')).toBe('1.00 km');
        expect(profilePanel().getByText('Selection').query()).toBeNull();
    });

    test('Two-finger zoom', async () => {
        await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        const graph = page.getByTestId('profile-graph').element();
        const scroller = graph.parentElement as HTMLElement;
        const before = graph.getBoundingClientRect().width;
        finger('pointerdown', 1, 0.4);
        finger('pointerdown', 2, 0.6);
        finger('pointermove', 1, 0.3);
        finger('pointermove', 2, 0.7);
        await expect.poll(() => graph.getBoundingClientRect().width).toBeCloseTo(before * 2, -1);
        // the middle of the graph stays in the middle of the frame, between the fingers
        expect(scroller.scrollLeft + scroller.clientWidth / 2).toBeCloseTo(graph.getBoundingClientRect().width / 2, -1);
        // a move of both fingers scrolls the graph
        const scroll = scroller.scrollLeft;
        finger('pointermove', 1, 0.2);
        finger('pointermove', 2, 0.6);
        await expect.poll(() => scroller.scrollLeft).toBeCloseTo(scroll + scroller.clientWidth * 0.1, -1);
        finger('pointerup', 1, 0.2);
        // the finger that stays after the pinch does not remove the selection and does not start one
        finger('pointerup', 2, 0.6);
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(profilePanel().getByText('Selection').query()).toBeNull();
    });
});

describe('Профиль следует за треком', () => {
    test('Правка во время профиля', async () => {
        const { map, api, router } = await render(VIEW);
        const a = P(41.69, 44.775);
        const b = P(41.692, 44.785);
        await newTrack(map, [a, b]);
        await expect.poll(() => router.calls.length).toBe(1);
        await rightClick(map, b);
        expect(await menuItems()).toContain('Show elevation profile for segment');
        await chooseFromMenu('Show elevation profile for segment');
        await expect.poll(() => api.requests.length).toBe(1);
        // a drag of a point: the router routes a new segment, and the profile builds again with one request after
        // the pause
        await drag(map, b, P(41.695, 44.785));
        await expect.poll(() => router.calls.length).toBe(2);
        await expect.poll(() => api.requests.length, { timeout: 3000 }).toBe(2);
        expect(api.requests[1]).toContain('41.695000');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(api.requests).toHaveLength(2);
    });

    test('Удаление трека', async () => {
        await render(trackLink('Walk', [SOUTH]));
        await openTrackProfile('Walk');
        await trackMenu('Walk', 'Delete');
        await expect.poll(() => profilePanel().query()).toBeNull();
    });
});

describe('Ошибка сервиса высот в профиле', () => {
    test('Сервис недоступен', async () => {
        const api = elevationApi((_, attempt) => {
            if (attempt === 1) {
                throw new TypeError('Failed to fetch');
            }
            return null;
        });
        await render(trackLink('Walk', [SOUTH]), api);
        await trackMenu('Walk', 'Show elevation profile');
        // toHaveTextContent with a string compares the full text, and the banner also contains the Retry button
        await expect.element(profilePanel().getByText('Failed to get elevation data: network error')).toBeVisible();
        await profilePanel().getByRole('button', { name: 'Retry' }).click();
        await expect.poll(() => stat('distance')).toBe('1.00 km');
        expect(profilePanel().getByRole('alert').query()).toBeNull();
        await expect.element(page.getByTestId('profile-line')).toBeInTheDocument();
    });

    test('Слишком частые запросы', async () => {
        await render(
            trackLink('Walk', [SOUTH]),
            elevationApi(() => new Response('Too many requests\n', { status: 429 })),
        );
        await trackMenu('Walk', 'Show elevation profile');
        await expect
            .element(profilePanel().getByText('Failed to get elevation data: too many requests, try again in a minute'))
            .toBeVisible();
    });
});
