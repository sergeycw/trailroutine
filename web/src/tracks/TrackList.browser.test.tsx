import type { FeatureCollection, LineString } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { renderApp, tracksButton } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { TRACK_COLORS } from './model';
import { saveNktk } from './nktk';
import { TRACK_LINES, TRACK_POINTS } from './style';

// Track list in App on a real map; tiles are a fixture, the storage and the proxy are a fetch stub.
// Test names are scenarios of the spec tracks.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(() => {
    cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

// 1° along the equator is 111 194.93 m (R = 6 371 000 m): two segments with a total length of ≈ 12 345 m
const LNG_FOR_METERS = (meters: number) => meters / ((6371000 * Math.PI) / 180);
const TWO_SEGMENTS = saveNktk({
    name: 'Equator',
    segments: [
        [
            { lat: 0, lng: 0 },
            { lat: 0, lng: LNG_FOR_METERS(6000) },
        ],
        [
            { lat: 0, lng: 1 },
            { lat: 0, lng: 1 + LNG_FOR_METERS(6345) },
        ],
    ],
    points: [{ lat: 0, lng: 0.01, name: 'Start' }],
});

function track(name: string, fields: Partial<Parameters<typeof saveNktk>[0]> = {}) {
    return saveNktk({
        name,
        segments: [
            [
                { lat: 41.69, lng: 44.8 },
                { lat: 41.7, lng: 44.81 },
            ],
        ],
        points: [],
        ...fields,
    });
}

// data of the GeoJSON source of tracks (the style always has the sources, src/tracks/style.ts)
function sourceData<T extends FeatureCollection>(map: MaplibreMap, id: string): T['features'] {
    const source = map.getSource(id);
    if (!source) {
        throw new Error(`нет источника ${id}`);
    }
    return (source.serialize() as { data: T }).data.features;
}

// features of track lines: one for each track segment (without route markup)
function lines(map: MaplibreMap) {
    return sourceData<FeatureCollection<LineString>>(map, TRACK_LINES);
}

function points(map: MaplibreMap) {
    return sourceData(map, TRACK_POINTS);
}

function rows() {
    return page.getByRole('list', { name: 'Tracks' }).getByRole('listitem');
}

async function trackMenu(name: string, item: string) {
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: item }).click();
}

async function listMenu(item: string) {
    await page.getByRole('button', { name: 'Tracks menu' }).click();
    await page.getByRole('menuitem', { name: item }).click();
}

describe('Список треков поверх карты', () => {
    test('Трек в списке', async () => {
        const { map } = await renderApp(tiles, `#m=5/0/0&l=O&nktk=${TWO_SEGMENTS}`);
        await expect.element(rows()).toHaveLength(1);
        const row = rows().first();
        await expect.element(row.getByRole('button', { name: 'Equator' })).toBeVisible();
        await expect.element(row.getByTestId('track-length')).toHaveTextContent('12.3 km');
        await expect.element(row.getByRole('checkbox', { name: 'Show Equator' })).toBeChecked();
        // one feature for each segment
        await expect.poll(() => lines(map)).toHaveLength(2);
    });

    test('Показать трек целиком', async () => {
        const { map } = await renderApp(tiles, `#m=8/0/100&l=O&nktk=${track('Far')}`);
        await expect.element(rows()).toHaveLength(1);
        await page.getByRole('button', { name: 'Far' }).click();
        await expect
            .poll(() => {
                const bounds = map.getBounds();
                return bounds.contains([44.8, 41.69]) && bounds.contains([44.81, 41.7]);
            })
            .toBe(true);
    });

    test('Список по кнопке', async () => {
        const { map } = await renderApp(tiles, `#nktk=${track('A')}`, { tracksOpen: false });
        const button = tracksButton();
        await expect.element(button).toHaveAccessibleName('Tracks 1');
        await expect.element(button).toHaveAttribute('aria-expanded', 'false');
        await expect.element(page.getByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
        await button.click();
        await expect.element(rows()).toHaveLength(1);
        // a press on the map (the MapLibre canvas) closes the list, the track stays on the map
        map.getCanvas().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await expect.element(page.getByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
        await expect.element(button).toHaveAttribute('aria-expanded', 'false');
        await expect.poll(() => lines(map)).toHaveLength(1);
    });
});

describe('Треки на карте', () => {
    test('Скрыть трек', async () => {
        const { map } = await renderApp(
            tiles,
            `#m=12/41.69/44.8&nktk=${track('A', { points: [{ lat: 41.69, lng: 44.8, name: 'P' }] })}`,
        );
        await expect.poll(() => [lines(map).length, points(map).length]).toEqual([1, 1]);
        await page.getByRole('checkbox', { name: 'Show A' }).click();
        await expect.poll(() => [lines(map).length, points(map).length]).toEqual([0, 0]);
        await expect.element(rows()).toHaveLength(1);
    });

    test('Сменить цвет', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => lines(map)[0]?.properties?.color).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await page.getByRole('button', { name: 'Color 4' }).click();
        await expect.poll(() => lines(map)[0]?.properties?.color).toBe(TRACK_COLORS[3]);
    });

    test('Shift+клик по флажку — показать только этот трек', async () => {
        await renderApp(tiles, `#nktk=${track('A')}/${track('B', { hidden: true })}/${track('C')}`);
        await userEvent.keyboard('{Shift>}');
        await page.getByRole('checkbox', { name: 'Show B' }).click();
        await userEvent.keyboard('{/Shift}');
        await expect.element(page.getByRole('checkbox', { name: 'Show A' })).not.toBeChecked();
        await expect.element(page.getByRole('checkbox', { name: 'Show B' })).toBeChecked();
        await expect.element(page.getByRole('checkbox', { name: 'Show C' })).not.toBeChecked();
    });
});
describe('Любой цвет трека', () => {
    // one line for each track, in the list order
    const color = (map: MaplibreMap, index: number) => lines(map)[index]?.properties?.color;
    const hex = () => page.getByRole('textbox', { name: 'Hex color' });

    // synthetic pointer on the hue bar: a fraction of the width from left to right
    function pointer(type: string, element: Element, x: number, pointerType = 'mouse') {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(
            new PointerEvent(type, {
                bubbles: true,
                pointerId: 1,
                pointerType,
                isPrimary: true,
                button: 0,
                buttons: type === 'pointerup' ? 0 : 1,
                clientX: rect.left + rect.width * x,
                clientY: rect.top + rect.height / 2,
            }),
        );
    }

    test('Свой цвет из поля hex', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => color(map, 0)).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await hex().fill('#14B8A6');
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => color(map, 0)).toBe('#14b8a6');
        await expect.element(hex()).toHaveValue('#14b8a6');
        await expect.element(page.getByRole('slider', { name: 'Hue' })).toBeVisible();
    });

    test.each(['mouse', 'touch'])('Свой цвет перетаскиванием: %s', async (pointerType) => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => color(map, 0)).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        const hue = page.getByRole('slider', { name: 'Hue' }).element();
        pointer('pointerdown', hue, 0.5, pointerType);
        pointer('pointermove', hue, 0.1, pointerType);
        await expect.element(page.getByRole('slider', { name: 'Hue' })).toHaveAttribute('aria-valuenow', '36');
        // while the pointer is not released, the track keeps the old color: the map would repaint in a frame or two
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(color(map, 0)).toBe(TRACK_COLORS[0]);
        pointer('pointerup', hue, 0.1, pointerType);
        const picked = (hex().element() as HTMLInputElement).value;
        expect(picked).not.toBe(TRACK_COLORS[0]);
        await expect.poll(() => color(map, 0)).toBe(picked);
    });

    test('Свой цвет с клавиатуры', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => color(map, 0)).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        const hue = page.getByRole('slider', { name: 'Hue' });
        const before = Number(hue.element().getAttribute('aria-valuenow'));
        (hue.element() as HTMLElement).focus();
        await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
        await expect.element(hue).toHaveAttribute('aria-valuenow', String(before + 10));
        const picked = (hex().element() as HTMLInputElement).value;
        expect(picked).not.toBe(TRACK_COLORS[0]);
        await expect.poll(() => color(map, 0)).toBe(picked);
    });

    test('Набранный hex при закрытии', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => color(map, 0)).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await hex().fill('#14b8a6');
        await userEvent.keyboard('{Escape}');
        await expect.element(hex()).not.toBeInTheDocument();
        await expect.poll(() => color(map, 0)).toBe('#14b8a6');
    });

    test('Неверный hex', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => color(map, 0)).toBe(TRACK_COLORS[0]);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await hex().fill('#12zz');
        (hex().element() as HTMLInputElement).blur();
        await expect.element(hex()).toHaveValue(TRACK_COLORS[0]);
        expect(color(map, 0)).toBe(TRACK_COLORS[0]);
    });

    test('Недавние цвета', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}/${track('B')}`);
        await expect.poll(() => lines(map)).toHaveLength(2);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await hex().fill('#14b8a6');
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => color(map, 0)).toBe('#14b8a6');
        await userEvent.keyboard('{Escape}');
        await expect.element(hex()).not.toBeInTheDocument();
        await page.getByRole('button', { name: 'Color of B' }).click();
        await expect.element(page.getByRole('button', { name: 'Recent color #14b8a6' })).toBeVisible();
        // one row of six: the custom color first, then the first five preset colors
        const swatches = page.getByRole('dialog').getByRole('button', { name: /^(Recent color|Color \d)/ });
        expect(swatches.elements().map((button) => button.ariaLabel)).toEqual([
            'Recent color #14b8a6',
            'Color 1',
            'Color 2',
            'Color 3',
            'Color 4',
            'Color 5',
        ]);
        await page.getByRole('button', { name: 'Recent color #14b8a6' }).click();
        await expect.poll(() => color(map, 1)).toBe('#14b8a6');
    });

    test('Выбранный готовый цвет в строке', async () => {
        // an old record of six recent colors: the three newest are read
        localStorage.setItem(
            'nakarte-web:recent-colors',
            JSON.stringify(['#111111', '#222222', '#333333', '#444444', '#555555', '#666666']),
        );
        await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A', { color: 5 })}`);
        await page.getByRole('button', { name: 'Color of A' }).click();
        const swatches = page.getByRole('dialog').getByRole('button', { name: /^(Recent color|Color \d)/ });
        expect(swatches.elements().map((button) => button.ariaLabel)).toEqual([
            'Recent color #111111',
            'Recent color #222222',
            'Recent color #333333',
            'Color 1',
            'Color 2',
            'Color 6',
        ]);
    });

    test('Фокус при открытии', async () => {
        await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A', { color: 1 })}`);
        await page.getByRole('button', { name: 'Color of A' }).click();
        await expect.element(page.getByRole('dialog')).toBeVisible();
        await expect.poll(() => document.activeElement?.getAttribute('role')).toBe('dialog');
        await userEvent.keyboard('{Escape}');
        await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
        (page.getByRole('button', { name: 'Color of A' }).element() as HTMLElement).focus();
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => document.activeElement?.ariaLabel).toBe('Color 2');
    });
});

describe('Действия с треком', () => {
    test('Переименовать', async () => {
        await renderApp(tiles, `#nktk=${track('Old name')}`);
        await trackMenu('Old name', 'Rename');
        const input = page.getByRole('textbox', { name: 'Track name' });
        await input.fill('New name');
        await page.getByRole('button', { name: 'Ok' }).click();
        await expect.element(page.getByRole('button', { name: 'New name' })).toBeVisible();
        // an empty name does not change the track
        await trackMenu('New name', 'Rename');
        await input.fill('  ');
        await page.getByRole('button', { name: 'Ok' }).click();
        await expect.element(page.getByRole('button', { name: 'New name' })).toBeVisible();
    });

    test('Развернуть', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await expect.poll(() => lines(map)).toHaveLength(1);
        const before = lines(map)[0].geometry.coordinates;
        const length = rows().first().getByTestId('track-length');
        const lengthBefore = length.element().textContent;
        await trackMenu('A', 'Reverse');
        await expect.poll(() => lines(map)[0].geometry.coordinates).toEqual([...before].reverse());
        expect(length.element().textContent).toBe(lengthBefore);
    });

    test('Дублировать', async () => {
        const { map } = await renderApp(tiles, `#m=12/41.69/44.8&nktk=${track('A')}`);
        await trackMenu('A', 'Duplicate');
        await expect.element(rows()).toHaveLength(2);
        await expect
            .poll(() => lines(map).map((feature) => feature.geometry.coordinates))
            .toSatisfy((all: unknown[]) => JSON.stringify(all[0]) === JSON.stringify(all[1]));
    });

    test('Удалить', async () => {
        await renderApp(tiles, `#nktk=${track('A')}/${track('B')}`);
        await trackMenu('A', 'Delete');
        await expect.element(rows()).toHaveLength(1);
        await expect.element(page.getByRole('button', { name: 'B' })).toBeVisible();
    });
});

describe('Действия со списком', () => {
    test('Удалить скрытые', async () => {
        await renderApp(tiles, `#nktk=${track('A')}/${track('B', { hidden: true })}/${track('C')}`);
        await expect.element(rows()).toHaveLength(3);
        await listMenu('Delete hidden tracks');
        await expect.element(rows()).toHaveLength(2);
        await listMenu('Delete all tracks');
        await expect.element(page.getByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
    });

    test('Новый трек из видимых', async () => {
        const { map } = await renderApp(
            tiles,
            `#m=12/41.69/44.8&nktk=${track('A', { points: [{ lat: 41.69, lng: 44.8, name: 'P' }] })}/${track('B')}/${track('C', { hidden: true })}`,
        );
        await listMenu('Create new track from all visible tracks');
        await expect.element(rows()).toHaveLength(4);
        // A, B and the two segments of the new track
        await expect.poll(() => lines(map)).toHaveLength(4);
        await expect.poll(() => points(map)).toHaveLength(2);
    });

    // the New track button is in the top row, and the list has no link field (design search-track-links): the new
    // track always gets the name "New track", the old client took the name from that field (design polish-web-ui,
    // «Макет 4a»)
    test('новый трек: New track и сразу рисование', async () => {
        await renderApp(tiles);
        await page.getByRole('button', { name: 'New track' }).click();
        await expect.element(rows()).toHaveLength(1);
        await expect.element(rows().first()).toHaveAttribute('data-track', 'New track');
        await expect.element(page.getByTestId('edit-panel')).toHaveAttribute('data-drawing');
    });
});

describe('Импорт', () => {
    test('Открыть GPX', async () => {
        await renderApp(tiles);
        const gpx =
            '<gpx><wpt lat="1" lon="2"><name>W1</name></wpt><wpt lat="1" lon="3"><name>W2</name></wpt>' +
            '<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.1" lon="2.1"/></trkseg>' +
            '<trkseg><trkpt lat="1.2" lon="2.2"/><trkpt lat="1.3" lon="2.3"/></trkseg></trk></gpx>';
        await userEvent.upload(page.getByTestId('track-file-input'), new File([gpx], 'walk.gpx'));
        await expect.element(page.getByRole('button', { name: 'walk.gpx' })).toBeVisible();
    });

    test('Неизвестный формат — тост, трек не добавлен', async () => {
        await renderApp(tiles);
        await userEvent.upload(page.getByTestId('track-file-input'), new File(['hello'], 'x.bin'));
        await expect
            .element(page.getByText('File "x.bin" has unsupported format or is badly corrupt, no data could be loaded'))
            .toBeVisible();
        await expect.element(page.getByRole('list', { name: 'Tracks' })).not.toBeInTheDocument();
    });

    test('Файл по ссылке', async () => {
        const requested: string[] = [];
        const gpx = '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>';
        await renderApp(tiles, '', {
            fetch: async (input) => {
                requested.push(String(input));
                return new Response(gpx);
            },
        });
        // the link goes into the search box (design search-track-links)
        await page.getByRole('combobox', { name: 'Search' }).fill('https://example.test/files/route.gpx');
        await expect.element(page.getByRole('option').getByText('route.gpx')).toBeVisible();
        await userEvent.keyboard('{Enter}');
        await expect.element(page.getByRole('button', { name: 'route.gpx' })).toBeVisible();
        expect(requested).toEqual([
            'https://nakarte-cors-proxy.nakarte-routing.workers.dev/https/example.test/files/route.gpx',
        ]);
    });
});

describe('Вид ожидания прокладки', () => {
    test('Загрузка треков по ссылке', async () => {
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        const gpx = '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>';
        await renderApp(tiles, '', {
            fetch: async () => {
                await released;
                return new Response(gpx);
            },
        });
        await page.getByRole('combobox', { name: 'Search' }).fill('https://example.test/files/route.gpx');
        await expect.element(page.getByRole('option').getByText('route.gpx')).toBeVisible();
        await userEvent.keyboard('{Enter}');
        // while the file loads, a spinner shows, not the routing thread
        await expect.element(tracksButton().getByLabelText('Loading tracks')).toBeInTheDocument();
        expect(tracksButton().element().querySelector('[data-testid="route-thread"]')).toBeNull();
        release();
        await expect.element(page.getByRole('button', { name: 'route.gpx' })).toBeVisible();
        await expect.element(tracksButton().getByLabelText('Loading tracks')).not.toBeInTheDocument();
    });
});

describe('Ссылка на треки после ответа хранилища', () => {
    function deferredStorage(response: () => Response | Promise<Response>) {
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
            release = resolve;
        });
        const posts: { url: string; body: string }[] = [];
        const fetchStub: typeof fetch = async (input, init) => {
            posts.push({ url: String(input), body: String(init?.body) });
            await released;
            return response();
        };
        return { fetchStub, posts, release };
    }

    test('Ссылка готова', async () => {
        const storage = deferredStorage(() => new Response(''));
        let clipboardText: string | null = null;
        let linkPromise: Promise<string> | null = null;
        await renderApp(tiles, `#m=12/41.69/44.8&l=O&q=search&nktk=${track('A')}`, {
            fetch: storage.fetchStub,
            writeClipboard: async (text) => {
                linkPromise = text;
                clipboardText = await text;
            },
        });
        await listMenu('Copy link for all tracks');
        await expect.poll(() => storage.posts).toHaveLength(1);
        // the write request is sent, there is no link yet: the storage did not respond
        expect(linkPromise).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(clipboardText).toBeNull();
        storage.release();
        await expect.poll(() => clipboardText).toMatch(/#m=12\/41\.69000\/44\.80000&l=O&nktl=[\w-]{22}$/u);
        const key = storage.posts[0].url.split('/').pop();
        expect(clipboardText).toContain(`nktl=${key}`);
        expect(storage.posts[0].url).toBe(`https://nakarte-tracks.nakarte-routing.workers.dev/track/${key}`);
        await expect.element(page.getByText('Link copied')).toBeVisible();
    });

    test('буфер недоступен — окно со ссылкой', async () => {
        const storage = deferredStorage(() => new Response(''));
        storage.release();
        await renderApp(tiles, `#nktk=${track('A')}`, {
            fetch: storage.fetchStub,
            writeClipboard: () => Promise.reject(new Error('denied')),
        });
        await trackMenu('A', 'Copy link for track');
        const input = page.getByRole('textbox', { name: 'Link to tracks' });
        await expect.element(input).toBeVisible();
        expect((input.element() as HTMLInputElement).value).toMatch(/nktl=[\w-]{22}$/u);
    });

    test('Хранилище недоступно', async () => {
        let clipboardText: string | null = null;
        await renderApp(tiles, `#nktk=${track('A')}`, {
            fetch: () => Promise.reject(new TypeError('Failed to fetch')),
            writeClipboard: async (text) => {
                clipboardText = await text;
            },
        });
        await listMenu('Copy link for all tracks');
        await expect.element(page.getByText('Error making link: network error')).toBeVisible();
        expect(clipboardText).toBeNull();
    });

    test('Слишком большой трек', async () => {
        await renderApp(tiles, `#nktk=${track('A')}`, {
            fetch: async () => new Response('', { status: 413 }),
            writeClipboard: async (text) => {
                await text;
            },
        });
        await listMenu('Copy link for visible tracks');
        await expect.element(page.getByText('Error making link: track is too big')).toBeVisible();
    });

    test('без треков — No tracks to copy', async () => {
        await renderApp(tiles);
        await listMenu('Copy link for all tracks');
        await expect.element(page.getByText('No tracks to copy')).toBeVisible();
    });
});
