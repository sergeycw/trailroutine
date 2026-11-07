import { describe, expect, it } from 'vitest';
import { saveNktk } from '@/tracks/nktk';
import mapyczJson from './fixtures/mapycz-mtatsminda.json';
import photonJson from './fixtures/photon-mtatsminda.json';
import { browserLanguages, mapyczUrl, parseMapycz } from './mapycz';
import { parsePhoton, photonUrl } from './photon';
import { search } from './search';

const PROXY = 'https://proxy.test/';
const CONTEXT = { lat: 41.69, lng: 44.78, zoom: 12, languages: ['ru-RU', 'ru', 'en-US'] };

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// a fake network: the answer by the request host, the requests are recorded
function network(responses: { mapy?: () => Response; photon?: () => Response }) {
    const requests: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
        const url = String(input);
        requests.push(url);
        const respond = url.includes('pro.mapy.cz') ? responses.mapy : responses.photon;
        if (!respond) {
            throw new TypeError('Failed to fetch');
        }
        return respond();
    };
    return { requests, sources: { fetch: fetchFn, corsProxyUrl: PROXY } };
}

describe('mapy.cz', () => {
    it('адрес запроса — через прокси, языки браузера, зум старого клиента, 5 результатов', () => {
        const url = mapyczUrl(PROXY, { query: 'mtatsminda', ...CONTEXT });
        expect(url).toBe(
            `${PROXY}https/pro.mapy.cz/suggest/?phrase=mtatsminda&lat=41.69&lon=44.78&zoom=13&lang=ru%2Cen&count=5`,
        );
    });

    it('без подходящих языков — en', () => {
        expect(browserLanguages(['ka-GE'], ['en', 'ru'])).toEqual([]);
        expect(mapyczUrl(PROXY, { query: 'x', ...CONTEXT, languages: ['ka'] })).toContain('lang=en');
    });

    it('разбор ответа: название, вторая строка, границы [lat, lng, lat, lng]', () => {
        const results = parseMapycz(mapyczJson);
        expect(results).toHaveLength(5);
        expect(results[0]).toEqual({
            title: 'Mtatsminda Park',
            subtitle: 'Amusement park, Tbilisi, Georgia',
            latlng: { lat: 41.69304014285044, lng: 44.77947664261119 },
            bounds: {
                south: 41.69015121459961,
                west: 44.77523422241211,
                north: 41.695945739746094,
                east: 44.78717041015625,
            },
            zoom: null,
        });
    });

    it('строка «Poloha» (координаты) выбрасывается, без границ — зум места', () => {
        const results = parseMapycz({
            result: [
                {
                    userData: {
                        suggestFirstRow: '41.7, 44.8',
                        suggestSecondRow: 'Poloha',
                        latitude: 41.7,
                        longitude: 44.8,
                    },
                },
                {
                    userData: {
                        suggestFirstRow: 'Spring',
                        suggestSecondRow: 'Spring, Georgia',
                        latitude: 41.7,
                        longitude: 44.8,
                    },
                },
            ],
        });
        expect(results).toEqual([
            { title: 'Spring', subtitle: 'Spring, Georgia', latlng: { lat: 41.7, lng: 44.8 }, bounds: null, zoom: 16 },
        ]);
    });

    it('чужой ответ — ошибка', () => {
        expect(() => parseMapycz({ items: [] })).toThrow('unexpected response');
    });
});

describe('photon', () => {
    it('адрес запроса: первый поддерживаемый язык браузера', () => {
        expect(photonUrl({ query: 'mtatsminda', ...CONTEXT, languages: ['ru', 'de-AT'] })).toBe(
            'https://photon.komoot.io/api/?limit=5&q=mtatsminda&lang=de&lat=41.69&lon=44.78',
        );
    });

    it('разбор ответа: extent — запад, север, восток, юг; без extent — зум места', () => {
        const results = parsePhoton(photonJson);
        expect(results[0]).toEqual({
            title: 'Mtatsminda',
            subtitle: 'neighbourhood, Tbilisi, Georgia',
            latlng: { lat: 41.6963552, lng: 44.7938539 },
            bounds: { west: 44.7893988, north: 41.7020007, east: 44.7974689, south: 41.6942535 },
            zoom: null,
        });
        expect(results[1]).toMatchObject({
            title: 'Mtatsminda',
            subtitle: 'station, Bombora Street, Tbilisi, Georgia',
            zoom: 16,
        });
        expect(results.at(-1)).toMatchObject({ subtitle: 'theme park, Bombora Street, Tbilisi, Georgia' });
    });
});

describe('поиск', () => {
    it('Ответ mapy.cz', async () => {
        const { requests, sources } = network({ mapy: () => json(mapyczJson) });
        const outcome = await search('mtatsminda', CONTEXT, sources);
        expect(outcome).toMatchObject({ kind: 'results', attribution: { text: 'Mapy.com' } });
        expect(outcome.kind === 'results' && outcome.results).toHaveLength(5);
        expect(requests).toHaveLength(1);
    });

    it('mapy.cz недоступен — запрос уходит в photon', async () => {
        const { requests, sources } = network({ mapy: () => json({}, 502), photon: () => json(photonJson) });
        const outcome = await search('mtatsminda', CONTEXT, sources);
        expect(outcome).toMatchObject({ kind: 'results', attribution: { text: 'Photon by Komoot' } });
        expect(requests.map((url) => new URL(url).hostname)).toEqual(['proxy.test', 'photon.komoot.io']);
    });

    it('Ничего не найдено — без запасного сервиса', async () => {
        const { requests, sources } = network({ mapy: () => json({ result: [] }) });
        expect(await search('qqqqqq', CONTEXT, sources)).toEqual({ kind: 'error', message: 'Nothing found' });
        expect(requests).toHaveLength(1);
    });

    it('Оба сервиса недоступны', async () => {
        const { sources } = network({ mapy: () => json({}, 500), photon: () => json({}, 503) });
        expect(await search('mtatsminda', CONTEXT, sources)).toEqual({
            kind: 'error',
            message: 'Search failed: HTTP 503',
        });
        const offline = network({});
        expect(await search('mtatsminda', CONTEXT, offline.sources)).toEqual({
            kind: 'error',
            message: 'Search failed: network error',
        });
    });

    it('координаты и ссылки — без сети', async () => {
        const { requests, sources } = network({});
        expect(await search('55.2 37.6', CONTEXT, sources)).toMatchObject({ kind: 'results', attribution: null });
        expect(await search('https://example.com/map', CONTEXT, sources)).toMatchObject({
            kind: 'results',
            results: [
                {
                    kind: 'track',
                    title: 'map',
                    subtitle: 'Open as track · example.com',
                    url: 'https://example.com/map',
                },
            ],
        });
        expect(await search('95 200', CONTEXT, sources)).toEqual({ kind: 'error', message: 'Invalid coordinates' });
        expect(requests).toEqual([]);
    });

    it('отменённый запрос бросает AbortError, а не уходит в photon', async () => {
        const controller = new AbortController();
        const requests: string[] = [];
        const fetchFn: typeof fetch = async (input, init) => {
            requests.push(String(input));
            controller.abort();
            throw init?.signal?.reason ?? new DOMException('aborted', 'AbortError');
        };
        await expect(
            search('mtatsminda', { ...CONTEXT, signal: controller.signal }, { fetch: fetchFn, corsProxyUrl: PROXY }),
        ).rejects.toThrow();
        expect(requests).toHaveLength(1);
    });
});

// the result order of a link: design search-track-links, «Порядок разбора ссылки»
describe('ссылки на треки', () => {
    async function titles(query: string) {
        const { requests, sources } = network({});
        const outcome = await search(query, CONTEXT, sources);
        expect(requests, 'разбор без сети').toEqual([]);
        return outcome.kind === 'results' ? outcome.results.map((item) => item.title) : outcome;
    }

    it('Ссылка nakarte с треком и видом', async () => {
        const nktk = saveNktk({ name: 'A', segments: [[{ lat: 1, lng: 2 }]], points: [] });
        const url = `https://nakarte-routing.pages.dev/#m=12/41.7/44.8&nktk=${nktk}`;
        const { requests, sources } = network({});
        const outcome = await search(url, CONTEXT, sources);
        expect(outcome).toMatchObject({
            kind: 'results',
            results: [
                { kind: 'track', title: 'Tracks from link', subtitle: 'Open as track', url },
                { title: 'Nakarte view' },
            ],
        });
        expect(requests).toEqual([]);
    });

    it('Линейка и вид Яндекса', async () => {
        expect(await titles('https://yandex.ru/maps/?ll=44.8,41.7&z=12&rl=44.8%2C41.7~0.01%2C0.02')).toEqual([
            'Yandex ruler',
            'Yandex map view',
        ]);
    });

    it('трек без вида: ошибка разбора вида не показывается', async () => {
        expect(await titles('https://www.openstreetmap.org/user/Wladich/traces/3376100')).toEqual([
            'OSM track 3376100',
        ]);
        expect(await titles('https://yandex.ru/maps/?rl=44.8%2C41.7~0.01%2C0.02')).toEqual(['Yandex ruler']);
    });

    it('track://', async () => {
        expect(await titles('track://abc')).toEqual(['Tracks from link']);
    });

    it('прямая ссылка на GPX трека OSM — любой файл', async () => {
        expect(await titles('https://www.openstreetmap.org/trace/3376100/data')).toEqual(['data']);
    });

    it('Ссылка на карту с негодными координатами', async () => {
        expect(await titles('https://www.google.com/maps/@49.1906435,190.5429962,14z')).toEqual({
            kind: 'error',
            message: 'Invalid coordinates in Google link',
        });
    });
});
