import { describe, expect, it } from 'vitest';
import { isLinkQuery, searchLink } from './links';

// The cases of the karma test of the old client test/test_search_links.js; the zoom in the expectations is the zoom
// of the old client (in the result it is 1 less, MapLibre). The old test expanded short links through the live proxy;
// here the proxy is a fake fetch: the final mapy.com addresses were captured with curl through the proxy of the clone
// on 2026-10-09 (favepemeko), the others are built from the same coordinates, one Google link goes to the captcha
// google.com/sorry/ with the address in continue.

const PROXY = 'https://proxy.test/';
const proxied = (url: string) => PROXY + url.replace(/^(https?):\/\//u, '$1/');
const MAPY_FAVEPEMEKO =
    'https://en.mapy.cz/zakladni?planovani-trasy&x=16.8975623&y=49.4113109&z=11&rc=9mml9x8qKR9nUl9xUR9Q&rs=muni&rs=muni&ri=6165&ri=3222&mrp=%7B%22c%22%3A111%7D&xc=%5B%5D&rut=1';
const DOLNI_MORAVA =
    'https://www.google.com/maps/place/561+69+Doln%C3%AD+Morava/@50.1568257,16.754047,12z/data=!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d50.1223171!4d16.7995866';
const ISTANBUL_PLACE =
    'https://www.google.com/maps/place/Mollafenari,+Elizi,+Bab-%C4%B1+Ali+Cd.+No:27,+34120+Fatih%2F%C4%B0stanbul,+Turkey/data=!4m2!3m1!1s0x14cab996a54299cb:0x40acb197d028d115?utm_source=mstt_1&entry=gps';
const REDIRECTS: Record<string, string> = {
    'https://mapy.cz/s/favepemeko': MAPY_FAVEPEMEKO,
    'https://mapy.com/s/favepemeko': MAPY_FAVEPEMEKO,
    'https://mapy.cz/s/lucacunomo': 'https://mapy.com/zakladni?x=16.8975623&y=49.4113109&z=11',
    'https://mapy.cz/s/mepevemazo': 'https://mapy.com/zakladni?x=16.8245081&y=50.1592323&z=12',
    'https://goo.gl/maps/cJ8wwQi9oMYM9yiy6': 'https://www.google.com/maps/@49.0030846,15.2993434,14z',
    'https://goo.gl/maps/ZvjVBY78HUP8HjQi6': `https://www.google.com/sorry/index?continue=${encodeURIComponent(DOLNI_MORAVA)}&q=abc`,
    'https://goo.gl/maps/iMv4esLL1nwF9yns7': DOLNI_MORAVA,
    // maps.app.goo.gl (2026-11-07): through the proxy Google answers with /sorry/ and the place in continue; a shared
    // place often has a name and no coordinates
    'https://maps.app.goo.gl/9ivZQ71CKMqRPDtQA': `https://www.google.com/sorry/index?continue=${encodeURIComponent(ISTANBUL_PLACE)}&q=abc`,
    'https://maps.app.goo.gl/viewOfDolniMorava': DOLNI_MORAVA,
};

// HEAD through the proxy: the browser follows the proxy redirects and gives the final address in response.url; an
// unknown short link gives a proxy 404 without a redirect
const requests: string[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method} ${url}`);
    const target = Object.entries(REDIRECTS).find(([from]) => proxied(from) === url)?.[1];
    return { url: target ? proxied(target) : url, ok: Boolean(target), status: target ? 200 : 404 } as Response;
};
const sources = { fetch: fakeFetch, corsProxyUrl: PROXY };

interface Expected {
    title: string;
    latlng: { lat: number; lng: number };
    zoom: number;
}

const VALID: [string, Expected[]][] = [
    [
        'https://www.google.com/maps/@49.1906435,16.5429962,14z',
        [{ title: 'Google map view', latlng: { lat: 49.1906435, lng: 16.5429962 }, zoom: 14 }],
    ],
    [
        'https://www.google.com.ua/maps/@49.1809973,61.6591562,5952m/data=!3m1!1e3?hl=ru',
        [{ title: 'Google map view', latlng: { lat: 49.1809973, lng: 61.6591562 }, zoom: 14 }],
    ],
    [
        'https://yandex.ru/maps/10509/brno/?ll=16.548629%2C49.219896&z=14',
        [{ title: 'Yandex map view', latlng: { lat: 49.219896, lng: 16.548629 }, zoom: 14 }],
    ],
    [
        'https://yandex.ru/maps/?ll=16.548629%2C49.219896&z=14',
        [{ title: 'Yandex map view', latlng: { lat: 49.219896, lng: 16.548629 }, zoom: 14 }],
    ],
    [
        'https://yandex.ru/maps/?l=sat&ll=16.843527%2C49.363860&z=13',
        [{ title: 'Yandex map view', latlng: { lat: 49.36386, lng: 16.843527 }, zoom: 13 }],
    ],
    [
        'https://yandex.ru/maps/?l=sat%2Cskl&ll=16.843527%2C49.363860&z=13',
        [{ title: 'Yandex map view', latlng: { lat: 49.36386, lng: 16.843527 }, zoom: 13 }],
    ],
    [
        'https://static-maps.yandex.ru/1.x/?lang=ru_RU&size=520%2C440&l=sat%2Cskl&z=14&ll=16.548629%2C49.219896',
        [{ title: 'Yandex map view', latlng: { lat: 49.219896, lng: 16.548629 }, zoom: 14 }],
    ],
    [
        'https://www.openstreetmap.org/#map=14/49.2199/16.5486',
        [{ title: 'OpenStreetMap view', latlng: { lat: 49.2199, lng: 16.5486 }, zoom: 14 }],
    ],
    [
        'https://en.mapy.cz/turisticka?x=16.5651083&y=49.2222502&z=14',
        [{ title: 'Mapy.com view', latlng: { lat: 49.2222502, lng: 16.5651083 }, zoom: 14 }],
    ],
    [
        'https://mapy.com/en/turisticka?x=16.5651083&y=49.2222502&z=14',
        [{ title: 'Mapy.com view', latlng: { lat: 49.2222502, lng: 16.5651083 }, zoom: 14 }],
    ],
    [
        'https://www.openstreetmap.org/search?query=%D0%BD%D0%B5%D1%80%D1%81%D0%BA%D0%BE%D0%B5%20%D0%BE%D0%B7%D0%B5%D1%80%D0%BE#map=17/55.56647/38.87365',
        [{ title: 'OpenStreetMap view', latlng: { lat: 55.56647, lng: 38.87365 }, zoom: 17 }],
    ],
    [
        'https://www.google.com/maps/place/Nerskoye+Ozero/@56.0836099,37.3849634,16z/data=!3m1!4b1!4m5!3m4!1s0x46b5178a0be6c5b1:0xb13c53547e1d966d!8m2!3d56.0826073!4d37.388256',
        [
            { title: 'Google map - Nerskoye Ozero', latlng: { lat: 56.0826073, lng: 37.388256 }, zoom: 14 },
            { title: 'Google map view', latlng: { lat: 56.0836099, lng: 37.3849634 }, zoom: 16 },
        ],
    ],
    [
        'https://www.google.ru/maps/place/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0,+%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F/@55.5807481,36.8251331,9z/data=!3m1!4b1!4m5!3m4!1s0x46b54afc73d4b0c9:0x3d44d6cc5757cf4c!8m2!3d55.755826!4d37.6173',
        [
            { title: 'Google map - Москва, Россия', latlng: { lat: 55.755826, lng: 37.6173 }, zoom: 14 },
            { title: 'Google map view', latlng: { lat: 55.5807481, lng: 36.8251331 }, zoom: 9 },
        ],
    ],
    [
        'https://www.google.com/maps/place/Vav%C5%99ineck%C3%A1,+514+01+Jilemnice/@50.6092632,15.5023689,17z/data=!3m1!4b1!4m5!3m4!1s0x470ebf1b56d0fca9:0xddb7e19a6b1f5828!8m2!3d50.6092632!4d15.5045576',
        [
            {
                title: 'Google map - Vavřinecká, 514 01 Jilemnice',
                latlng: { lat: 50.6092632, lng: 15.5045576 },
                zoom: 14,
            },
            { title: 'Google map view', latlng: { lat: 50.6092632, lng: 15.5023689 }, zoom: 17 },
        ],
    ],
    [
        'https://www.google.com/maps?q=loc:49.1817864,16.5771214',
        [{ title: 'Google map view', latlng: { lat: 49.1817864, lng: 16.5771214 }, zoom: 17 }],
    ],
    [
        'https://maps.google.com/maps?q=49.223089,16.554547&ll=49.223089,16.554547&z=16',
        [{ title: 'Google map view', latlng: { lat: 49.223089, lng: 16.554547 }, zoom: 17 }],
    ],
    [
        'https://www.google.com/maps?q=loc:-49.1817864,-16.5771214',
        [{ title: 'Google map view', latlng: { lat: -49.1817864, lng: -16.5771214 }, zoom: 17 }],
    ],
    [
        'https://www.google.ru/maps?q=loc:-49.1817864,-16.5771214',
        [{ title: 'Google map view', latlng: { lat: -49.1817864, lng: -16.5771214 }, zoom: 17 }],
    ],
    [
        'https://www.google.com/maps/@49.1906435,16.5429962,14z?q=loc:49.1817864,16.5771214',
        [{ title: 'Google map view', latlng: { lat: 49.1906435, lng: 16.5429962 }, zoom: 14 }],
    ],
    [
        'https://www.google.com/maps/place/Nerskoye+Ozero/@56.0836099,37.3849634,16z/data=!3m1!4b1!4m5!3m4!1s0x46b5178a0be6c5b1:0xb13c53547e1d966d!8m2!3d56.0826073!4d37.388256?q=loc:-49.1817864,-16.5771214',
        [
            { title: 'Google map - Nerskoye Ozero', latlng: { lat: 56.0826073, lng: 37.388256 }, zoom: 14 },
            { title: 'Google map view', latlng: { lat: 56.0836099, lng: 37.3849634 }, zoom: 16 },
        ],
    ],
    [
        'https://www.google.com/maps/place/Nerskoye+Ozero/data=!3m1!4b1!4m5!3m4!1s0x46b5178a0be6c5b1:0xb13c53547e1d966d!8m2!3d56.0826073!4d37.388256',
        [{ title: 'Google map - Nerskoye Ozero', latlng: { lat: 56.0826073, lng: 37.388256 }, zoom: 14 }],
    ],
    [
        'https://www.google.com/maps/place/Nerskoye+Ozero/@56.0836099,37.3849634,16z/',
        [{ title: 'Google map view', latlng: { lat: 56.0836099, lng: 37.3849634 }, zoom: 16 }],
    ],
    [
        'https://www.google.com/maps/@56.0836099,37.3849634,16z/data=!3m1!4b1!4m5!3m4!1s0x46b5178a0be6c5b1:0xb13c53547e1d966d!8m2!3d56.0826073!4d37.388256',
        [{ title: 'Google map view', latlng: { lat: 56.0836099, lng: 37.3849634 }, zoom: 16 }],
    ],
    [
        'https://www.google.com/maps/@48.6514614,16.9945421,3a,75y,253.17h,90t/data=!3m7!1e1!3m5!1s4MYpvu63gL3ZArPiSohExg!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com%2Fv1%2Fthumbnail%3Fpanoid%3D4MYpvu63gL3ZArPiSohExg%26cb_client%3Dmaps_sv.tactile.gps%26w%3D203%26h%3D100%26yaw%3D253.16992%26pitch%3D0%26thumbfov%3D100!7i13312!8i6656',
        [{ title: 'Google map view', latlng: { lat: 48.6514614, lng: 16.9945421 }, zoom: 16 }],
    ],
    [
        'https://nakarte.me/#m=11/49.44893/16.59897&l=O',
        [{ title: 'Nakarte view', latlng: { lat: 49.44893, lng: 16.59897 }, zoom: 11 }],
    ],
    [
        'https://nakarte.me/#l=O&m=11/49.44893/16.59897',
        [{ title: 'Nakarte view', latlng: { lat: 49.44893, lng: 16.59897 }, zoom: 11 }],
    ],
    [
        'https://example.com/#l=O&m=11/49.44893/16.59897',
        [{ title: 'Nakarte view', latlng: { lat: 49.44893, lng: 16.59897 }, zoom: 11 }],
    ],
    [
        'https://mapy.cz/s/favepemeko',
        [{ title: 'Mapy.com view', latlng: { lat: 49.4113109, lng: 16.8975623 }, zoom: 11 }],
    ],
    [
        'https://en.mapy.cz/s/favepemeko',
        [{ title: 'Mapy.com view', latlng: { lat: 49.4113109, lng: 16.8975623 }, zoom: 11 }],
    ],
    [
        'https://mapy.com/s/favepemeko',
        [{ title: 'Mapy.com view', latlng: { lat: 49.4113109, lng: 16.8975623 }, zoom: 11 }],
    ],
    [
        'https://mapy.cz/s/lucacunomo',
        [{ title: 'Mapy.com view', latlng: { lat: 49.4113109, lng: 16.8975623 }, zoom: 11 }],
    ],
    [
        'https://mapy.cz/s/mepevemazo',
        [{ title: 'Mapy.com view', latlng: { lat: 50.1592323, lng: 16.8245081 }, zoom: 12 }],
    ],
    [
        'https://goo.gl/maps/cJ8wwQi9oMYM9yiy6',
        [{ title: 'Google map view', latlng: { lat: 49.0030846, lng: 15.2993434 }, zoom: 14 }],
    ],
    [
        'https://goo.gl/maps/ZvjVBY78HUP8HjQi6',
        [
            { title: 'Google map - 561 69 Dolní Morava', latlng: { lat: 50.1223171, lng: 16.7995866 }, zoom: 14 },
            { title: 'Google map view', latlng: { lat: 50.1568257, lng: 16.754047 }, zoom: 12 },
        ],
    ],
    [
        'https://goo.gl/maps/iMv4esLL1nwF9yns7',
        [
            { title: 'Google map - 561 69 Dolní Morava', latlng: { lat: 50.1223171, lng: 16.7995866 }, zoom: 14 },
            { title: 'Google map view', latlng: { lat: 50.1568257, lng: 16.754047 }, zoom: 12 },
        ],
    ],
    [
        'http://openstreetmap.ru/?mapid=497235296#map=12/60.9426/29.849&layer=C',
        [{ title: 'OpenStreetMap view', latlng: { lat: 60.9426, lng: 29.849 }, zoom: 12 }],
    ],
];

const INVALID: [string, string][] = [
    ['https://', 'Invalid link'],
    ['http://', 'Invalid link'],
    ['https://example.com', 'Unsupported link'],
    ['https://yandex.ru/maps/', 'Invalid coordinates in Yandex link'],
    ['https://yandex.ru/maps/10509/brno/?ll=16.548629%2C149.219896&z=14', 'Invalid coordinates in Yandex link'],
    [
        'https://static-maps.yandex.ru/1.x/?lang=ru_RU&size=520%2C440&l=sat%2Cskl&ll=16.548629%2C49.219896',
        'Invalid coordinates in Yandex link',
    ],
    ['https://en.mapy.cz/turisticka?x=16.5651083&y=49.2222502&z=', 'Invalid coordinates in Mapy.com link'],
    ['https://mapy.com/en/turisticka?x=16.5651083&y=49.2222502&z=', 'Invalid coordinates in Mapy.com link'],
    ['https://www.google.com/maps', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps/@99.1906435,16.5429962,14z', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps/@49.1906435,190.5429962,14z', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps/@49.1906435,19.5429962,45z', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:49.1817864,', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:49.1817864', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:4', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:99.1817864,16.5771214', 'Invalid coordinates in Google link'],
    ['https://www.google.com/maps?q=loc:49.1817864,196.5771214', 'Invalid coordinates in Google link'],
    ['https://nakarte.me/', 'Invalid coordinates in Nakarte link'],
    ['https://nakarte.me/#l=O', 'Invalid coordinates in Nakarte link'],
    ['https://example.com/#l=O&m=11/49.44893/', 'Unsupported link'],
    // OSM without map= is not a view but, for example, a direct link to the GPX of a track (design search-track-links)
    ['https://www.openstreetmap.org/trace/3376100/data', 'Unsupported link'],
    ['https://www.openstreetmap.org/#map=14/abc', 'Invalid coordinates in OpenStreetMap link'],
    ['https://example.com/#l=O&m=99/49.44893/52.5547', 'Unsupported link'],
    ['https://mapy.cz/s/lucacunom', 'Broken Mapy.com short link'],
    ['https://mapy.com/s/lucacunom', 'Broken Mapy.com short link'],
    ['https://goo.gl/maps/ZvjVBY78HUP8HjQi', 'Broken Google short link'],
];

const NOT_LINKS = ['abc', 'http:/', 'https:/', 'https:/', 'track:/'];

describe('ссылки на карты', () => {
    it.each(VALID)('%s', async (query, expected) => {
        expect(isLinkQuery(query)).toBe(true);
        const result = await searchLink(query, sources);
        expect(
            'results' in result && result.results.map(({ title, latlng, zoom }) => ({ title, latlng, zoom })),
        ).toEqual(expected.map((item) => ({ ...item, zoom: item.zoom - 1 })));
    });

    it.each(INVALID)('неверная ссылка %s', async (query, error) => {
        expect(isLinkQuery(query)).toBe(true);
        expect(await searchLink(query, sources)).toEqual({ error });
    });

    it.each(NOT_LINKS)('не ссылка %s', (query) => {
        expect(isLinkQuery(query)).toBe(false);
    });

    it('track:// — ссылка', () => {
        expect(isLinkQuery('track://abc')).toBe(true);
    });

    it('короткая ссылка — HEAD через прокси, языковой поддомен mapy убран', async () => {
        requests.length = 0;
        await searchLink('https://en.mapy.cz/s/favepemeko', sources);
        expect(requests).toEqual([`HEAD ${proxied('https://mapy.cz/s/favepemeko')}`]);
    });

    it('Неизвестная ссылка', async () => {
        expect(await searchLink('https://example.com/map', sources)).toEqual({ error: 'Unsupported link' });
    });

    it('Короткая ссылка Google на место', async () => {
        requests.length = 0;
        expect(await searchLink('https://maps.app.goo.gl/9ivZQ71CKMqRPDtQA', sources)).toEqual({
            placeName: 'Mollafenari, Elizi, Bab-ı Ali Cd. No:27, 34120 Fatih/İstanbul, Turkey',
        });
        expect(requests).toEqual([`HEAD ${proxied('https://maps.app.goo.gl/9ivZQ71CKMqRPDtQA')}`]);
        const view = await searchLink('https://maps.app.goo.gl/viewOfDolniMorava', sources);
        expect('results' in view && view.results.map((item) => item.title)).toEqual([
            'Google map - 561 69 Dolní Morava',
            'Google map view',
        ]);
    });

    it('Ссылка OpenStreetMap', async () => {
        expect(await searchLink('https://www.openstreetmap.org/#map=14/49.2199/16.5486', sources)).toEqual({
            results: [
                {
                    title: 'OpenStreetMap view',
                    subtitle: null,
                    latlng: { lat: 49.2199, lng: 16.5486 },
                    bounds: null,
                    zoom: 13,
                },
            ],
        });
    });
});
