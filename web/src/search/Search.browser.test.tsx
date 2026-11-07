import type { Point } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { config } from '@/config';
import { fakeRouter } from '@/test/fake-router';
import { click, features, near, P, waypoints } from '@/test/map-events';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { saveNktk } from '@/tracks/nktk';
import { TRACK_POINTS } from '@/tracks/style';
import mapyczJson from './fixtures/mapycz-mtatsminda.json';
import photonJson from './fixtures/photon-mtatsminda.json';

// Search and the placemark in App on a real map (spec map-search): the network is a fetch stub with saved answers of
// mapy.cz and photon, the tests do not go to the network. The test titles are the scenarios of the spec.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

const VIEW = '#m=15/41.69/44.785&l=O';

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// the network: mapy.cz through the proxy and photon give the set answers, the rest is a network error; the requests
// are recorded
function searchNetwork(responses: { mapy?: () => Response; photon?: () => Response; other?: typeof fetch } = {}) {
    const requests: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith(`${config.corsProxyUrl}https/pro.mapy.cz/`) && responses.mapy) {
            return responses.mapy();
        }
        if (url.startsWith('https://photon.komoot.io/') && responses.photon) {
            return responses.photon();
        }
        if (responses.other) {
            return responses.other(input, init);
        }
        throw new TypeError('Failed to fetch');
    };
    return { requests, fetch: fetchFn };
}

const searchField = () => page.getByRole('combobox', { name: 'Search' });
const options = () => page.getByRole('option');
const optionTitles = () =>
    options()
        .elements()
        .map((element) => element.querySelector('div')?.textContent ?? '');
const placemark = () => page.getByTestId('placemark');

async function render(hash = '', fetchFn?: typeof fetch) {
    return renderApp(tiles, `${VIEW}${hash}`, { fetch: fetchFn, router: fakeRouter({ auto: true }) });
}

describe('Строка поиска', () => {
    test('Короткий запрос', async () => {
        const net = searchNetwork();
        await render('', net.fetch);
        await searchField().fill('ab');
        await expect.element(page.getByText('Type at least 3 characters')).toBeVisible();
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(net.requests).toEqual([]);
    });

    test('Горячая клавиша', async () => {
        await render();
        document.querySelector<HTMLElement>('.maplibregl-canvas')?.focus();
        await userEvent.keyboard('{Alt>}l{/Alt}');
        await expect.element(searchField()).toHaveFocus();
    });
});

describe('Поиск по названию', () => {
    test('Ответ mapy.cz', async () => {
        const net = searchNetwork({ mapy: () => json(mapyczJson) });
        await render('', net.fetch);
        await searchField().fill('mtatsminda');
        await expect.poll(optionTitles).toHaveLength(5);
        expect(optionTitles()[0]).toBe('Mtatsminda Park');
        await expect.element(page.getByText('Amusement park, Tbilisi, Georgia')).toBeVisible();
        await expect.element(page.getByRole('link', { name: 'Mapy.com' })).toBeVisible();
        // input pause: one string, one request
        expect(net.requests.filter((url) => url.includes('pro.mapy.cz'))).toHaveLength(1);
        expect(net.requests[0]).toContain('phrase=mtatsminda');
    });

    test('mapy.cz недоступен', async () => {
        const net = searchNetwork({ mapy: () => json({}, 502), photon: () => json(photonJson) });
        await render('', net.fetch);
        await searchField().fill('mtatsminda');
        await expect.poll(optionTitles).toHaveLength(5);
        await expect.element(page.getByRole('link', { name: 'Photon by Komoot' })).toBeVisible();
    });

    test('Ничего не найдено', async () => {
        const net = searchNetwork({ mapy: () => json({ result: [] }) });
        await render('', net.fetch);
        await searchField().fill('qqqqqq');
        await expect.element(page.getByTestId('search-error')).toHaveTextContent('Nothing found');
    });

    test('Оба сервиса недоступны', async () => {
        const net = searchNetwork({ mapy: () => json({}, 500), photon: () => json({}, 503) });
        const { map } = await render('', net.fetch);
        const center = map.getCenter();
        await searchField().fill('mtatsminda');
        await expect.element(page.getByTestId('search-error')).toHaveTextContent('Search failed: HTTP 503');
        expect(map.getCenter()).toEqual(center);
    });
});

describe('Устаревшие ответы', () => {
    test('Ответ на устаревший запрос отбрасывается', async () => {
        // the first request answers later than the second
        let releaseFirst!: () => void;
        const firstAnswered = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const requests: string[] = [];
        const fetchFn: typeof fetch = async (input) => {
            const url = String(input);
            requests.push(url);
            if (url.includes('phrase=mtatsminda')) {
                await firstAnswered;
                return json(mapyczJson);
            }
            return json({
                result: [
                    {
                        userData: {
                            suggestFirstRow: 'Rustaveli',
                            suggestSecondRow: 'Avenue',
                            latitude: 41.7,
                            longitude: 44.79,
                        },
                    },
                ],
            });
        };
        await render('', fetchFn);
        await searchField().fill('mtatsminda');
        await expect.poll(() => requests).toHaveLength(1);
        await searchField().fill('rustaveli');
        await expect.poll(optionTitles).toEqual(['Rustaveli']);
        releaseFirst();
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(optionTitles()).toEqual(['Rustaveli']);
    });

    test('Enter в паузе ввода не выбирает результат прежнего запроса', async () => {
        const net = searchNetwork({ mapy: () => json(mapyczJson) });
        await render('', net.fetch);
        await searchField().fill('mtatsminda');
        await expect.poll(optionTitles).toHaveLength(5);
        await searchField().fill('mtatsminda park');
        await userEvent.keyboard('{Enter}');
        await expect.element(placemark()).not.toBeInTheDocument();
    });
});

describe('Поиск по координатам и ссылкам', () => {
    test('Координаты с полушариями', async () => {
        const net = searchNetwork();
        await render('', net.fetch);
        await searchField().fill('55°52.981′S36°59.540′W');
        await expect.poll(optionTitles).toEqual(['S 55°52.981′ W 36°59.54′']);
        expect(net.requests).toEqual([]);
    });

    test('Неоднозначный порядок', async () => {
        await render();
        await searchField().fill('55.2 37.6');
        await expect.poll(optionTitles).toEqual(['55.2° 37.6°', '37.6° 55.2°']);
    });

    test('Неверные координаты', async () => {
        await render();
        await searchField().fill('95 200');
        await expect.element(page.getByTestId('search-error')).toHaveTextContent('Invalid coordinates');
    });

    test('Ссылка Google с местом', async () => {
        await render();
        await searchField().fill(
            'https://www.google.com/maps/place/Nerskoye+Ozero/@56.0836099,37.3849634,16z/data=!3m1!4b1!4m5!3m4!1s0x46b5178a0be6c5b1:0xb13c53547e1d966d!8m2!3d56.0826073!4d37.388256',
        );
        await expect.poll(optionTitles).toEqual(['Google map - Nerskoye Ozero', 'Google map view']);
    });

    test('Ссылка OpenStreetMap', async () => {
        const { map } = await render();
        await searchField().fill('https://www.openstreetmap.org/#map=14/49.2199/16.5486');
        await expect.poll(optionTitles).toEqual(['OpenStreetMap view']);
        await options().first().click();
        await expect.poll(() => near(map.getCenter(), P(49.2199, 16.5486))).toBe(true);
        expect(map.getZoom()).toBe(13);
        await expect.poll(() => location.hash).toContain('m=14/49.21990/16.54860');
    });

    test('Неизвестная ссылка', async () => {
        const network = searchNetwork();
        await render('', network.fetch);
        await searchField().fill('https://example.com/map');
        await expect.poll(optionTitles).toEqual(['map']);
        await expect.element(options().first().getByText('Open as track · example.com')).toBeVisible();
        expect(network.requests).toEqual([]);
    });
});

// a point on the map screen: the track shows fully if both ends are visible
const shows = (map: MaplibreMap, point: { lat: number; lng: number }) =>
    map.getBounds().contains([point.lng, point.lat]);

// spec map-search, «Ссылки на треки в поиске» and «Выбор ссылки на трек»; the order is in design search-track-links
describe('Ссылки на треки в поиске', () => {
    test('Ссылка nakarte с треком и видом', async () => {
        // the track is far from the link view: Enter opens the track and shows it, not the view
        const nktk = saveNktk({ name: 'Linked', segments: [[P(43, 42), P(43.01, 42.02)]], points: [] });
        const { map } = await render();
        await searchField().fill(`https://nakarte-routing.pages.dev/#m=12/41.7/44.8&nktk=${nktk}`);
        await expect.poll(optionTitles).toEqual(['Tracks from link', 'Nakarte view']);
        await userEvent.keyboard('{Enter}');
        await expect.element(page.getByRole('button', { name: 'Linked' })).toBeVisible();
        await expect.poll(() => shows(map, P(43, 42)) && shows(map, P(43.01, 42.02))).toBe(true);
        await expect.element(searchField()).toHaveValue('');
        await expect.element(placemark()).not.toBeInTheDocument();
    });

    test('Линейка и вид Яндекса', async () => {
        const network = searchNetwork();
        await render('', network.fetch);
        await searchField().fill('https://yandex.ru/maps/?ll=44.8,41.7&z=12&rl=44.8%2C41.7~0.01%2C0.02');
        await expect.poll(optionTitles).toEqual(['Yandex ruler', 'Yandex map view']);
        expect(network.requests).toEqual([]);
    });

    test('Ссылка на карту с негодными координатами', async () => {
        await render();
        await searchField().fill('https://www.google.com/maps/@49.1906435,190.5429962,14z');
        await expect.element(page.getByTestId('search-error')).toHaveTextContent('Invalid coordinates in Google link');
        expect(options().elements()).toHaveLength(0);
    });
});

describe('Выбор ссылки на трек', () => {
    test('Трек OSM из поиска', async () => {
        const gpx =
            '<gpx><trk><name>Kazbek</name><trkseg><trkpt lat="42.7" lon="44.5"/><trkpt lat="42.71" lon="44.52"/></trkseg></trk></gpx>';
        const network = searchNetwork({
            other: async (input) =>
                String(input) === `${config.corsProxyUrl}https/www.openstreetmap.org/trace/3376100/data`
                    ? new Response(gpx)
                    : new Response('', { status: 404 }),
        });
        const { map } = await render('', network.fetch);
        await searchField().fill('https://www.openstreetmap.org/user/Wladich/traces/3376100');
        await expect.poll(optionTitles).toEqual(['OSM track 3376100']);
        // before the choice, the track does not download
        expect(network.requests).toEqual([]);
        await userEvent.keyboard('{Enter}');
        await expect.element(page.getByRole('button', { name: 'Kazbek' })).toBeVisible();
        await expect.poll(() => shows(map, P(42.7, 44.5)) && shows(map, P(42.71, 44.52))).toBe(true);
        await expect.element(searchField()).toHaveValue('');
    });

    test('Файл трека из поиска', async () => {
        const gpx = '<gpx><trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="3" lon="4"/></trkseg></trk></gpx>';
        const network = searchNetwork({ other: async () => new Response(gpx) });
        await render('', network.fetch);
        await searchField().fill('https://example.test/files/route.gpx');
        await options().first().click();
        await expect.element(page.getByRole('button', { name: 'route.gpx' })).toBeVisible();
        expect(network.requests).toEqual([`${config.corsProxyUrl}https/example.test/files/route.gpx`]);
    });

    test('Ссылка не скачалась', async () => {
        const network = searchNetwork({ other: async () => new Response('', { status: 404 }) });
        await render('', network.fetch);
        await searchField().fill('https://example.test/files/missing.gpx');
        await expect.poll(optionTitles).toEqual(['missing.gpx']);
        await userEvent.keyboard('{Enter}');
        await expect
            .element(page.getByText(/^Could not download file from url "https:\/\/example\.test\/files\/missing\.gpx"/))
            .toBeVisible();
        await expect.element(page.getByText('No tracks yet', { exact: false })).toBeVisible();
    });
});

describe('Выбор результата поиска', () => {
    test('Результат с границами', async () => {
        const net = searchNetwork({ mapy: () => json(mapyczJson) });
        const { map } = await render('', net.fetch);
        await searchField().fill('mtatsminda');
        await expect.poll(optionTitles).toHaveLength(5);
        await options().first().click();
        // the bounds of Mtatsminda Park from the answer: 41.6902–41.6959, 44.7752–44.7872
        await expect
            .poll(
                () => Math.abs(map.getCenter().lat - 41.69305) < 1e-3 && Math.abs(map.getCenter().lng - 44.7812) < 1e-3,
            )
            .toBe(true);
        const bounds = map.getBounds();
        expect(bounds.contains([44.7753, 41.6903]) && bounds.contains([44.7871, 41.6958])).toBe(true);
        await expect.element(placemark()).toHaveTextContent('Mtatsminda Park');
        expect(location.hash).toContain('&r=41.693040/44.779477/Mtatsminda%20Park');
        // the list closed, the focus went to the map
        await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
    });

    test('Выбор клавишами', async () => {
        const net = searchNetwork({ mapy: () => json(mapyczJson) });
        await render('', net.fetch);
        await searchField().fill('mtatsminda');
        await expect.poll(optionTitles).toHaveLength(5);
        await userEvent.keyboard('{ArrowDown}{Enter}');
        await expect.element(placemark()).toHaveTextContent('Mtatsminda, Sololaki');
    });

    test('Escape убирает результаты', async () => {
        await render();
        await searchField().fill('55.2 37.6');
        await expect.poll(optionTitles).toHaveLength(2);
        await userEvent.keyboard('{Escape}');
        await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
        // the focus goes to the map (escapePressed → setFocusToMap of the old client)
        await expect.poll(() => document.activeElement?.classList.contains('maplibregl-canvas')).toBe(true);
    });
});

const MARK = '&r=41.691000/44.783000/Mtatsminda';

describe('Метка найденного места', () => {
    test('Клик мимо метки', async () => {
        const { map } = await render(MARK);
        await expect.element(placemark()).toHaveTextContent('Mtatsminda');
        await click(map, P(41.688, 44.789));
        await expect.element(placemark()).not.toBeInTheDocument();
    });

    test('Точка трека на месте метки', async () => {
        const { map } = await render(`${MARK}&nktp=41.689/44.784/Spring`);
        await page.getByRole('button', { name: 'Actions for Spring' }).click();
        await page.getByRole('menuitem', { name: 'Add point', exact: true }).click();
        await placemark().click();
        // the name window of the new point has the placemark name
        await expect.element(page.getByRole('textbox', { name: 'Point name' })).toHaveValue('Mtatsminda');
        await page.getByRole('button', { name: 'Ok' }).click();
        await expect
            .poll(() =>
                features<Point>(map, TRACK_POINTS).map((f) => [
                    f.properties?.name,
                    near(P(f.geometry.coordinates[1], f.geometry.coordinates[0]), P(41.691, 44.783)),
                ]),
            )
            .toContainEqual(['Mtatsminda', true]);
        await expect.element(placemark()).not.toBeInTheDocument();
    });

    test('Линия к метке', async () => {
        const { map } = await render(MARK);
        await page.getByRole('button', { name: 'New track' }).first().click();
        await click(map, P(41.688, 44.789));
        await placemark().click();
        await expect.poll(() => waypoints(map)).toHaveLength(2);
        expect(near(waypoints(map)[1], P(41.691, 44.783))).toBe(true);
        await expect.element(placemark()).not.toBeInTheDocument();
    });
});

describe('Клик по метке вне постановки точек и рисования', () => {
    test('уходит карте: метка снимается, как клик мимо неё у старого клиента', async () => {
        await render(MARK);
        await placemark().click();
        await expect.element(placemark()).not.toBeInTheDocument();
    });
});

describe('Метка в адресе', () => {
    test('Ссылка с меткой', async () => {
        await render('&r=41.693040/44.779477/Mtatsminda%20Park');
        await expect.element(placemark()).toHaveTextContent('Mtatsminda Park');
    });

    test('Метка убрана', async () => {
        const { map } = await render(MARK);
        await click(map, P(41.688, 44.789));
        await expect.poll(() => location.hash).not.toContain('r=');
    });

    test('Copy link без метки', async () => {
        const net = searchNetwork({ other: async () => new Response('', { status: 200 }) });
        let copied: string | null = null;
        await renderApp(tiles, `${VIEW}${MARK}&nktp=41.689/44.784/Spring`, {
            fetch: net.fetch,
            router: fakeRouter({ auto: true }),
            writeClipboard: async (text) => {
                copied = await text;
            },
        });
        await page.getByRole('button', { name: 'Actions for Spring' }).click();
        await page.getByRole('menuitem', { name: 'Copy link for track', exact: true }).click();
        await expect.poll(() => copied).toContain('nktl=');
        expect(copied).not.toContain('r=');
    });
});
