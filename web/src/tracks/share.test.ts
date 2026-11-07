import { describe, expect, test } from 'vitest';
import type { Track } from './model';
import { parseNktk } from './nktk';
import { ShareError, shareBody, shareLink, storeTracks, trackKey } from './share';
import { fakeSources, TEST_STORAGE } from './test-sources';

// The pair "POST body, nktl key" taken from the old client (workers/tracks/test/fixtures/client-track.json)
const CLIENT_BODY = 'RAoCEAESIAoJTmV3IHRyYWNrEhMKB4Ka7QGxAXYSCIjW_gGQA5AD';
const CLIENT_KEY = 'eULz6eCr_il5HksAhitPnA';

function track(fields: Partial<Track> = {}): Track {
    return { id: '1', name: 'T', segments: [], points: [], color: 0, visible: true, ...fields };
}

describe('тело и ключ', () => {
    test('ключ — как у старого клиента и Worker', () => {
        expect(trackKey(CLIENT_BODY)).toBe(CLIENT_KEY);
    });

    test('тело трека старого клиента собирается заново байт в байт', () => {
        const [parsed] = parseNktk(CLIENT_BODY);
        expect(shareBody([track({ ...parsed, color: parsed.color ?? 0, visible: !parsed.hidden })])).toBe(CLIENT_BODY);
    });

    test('видимость: скрытый трек пишется скрытым, forceVisible — видимым', () => {
        const hidden = track({ visible: false });
        expect(parseNktk(shareBody([hidden]))[0].hidden).toBe(true);
        expect(parseNktk(shareBody([hidden], true))[0].hidden).toBe(false);
    });

    test('несколько треков — через /', () => {
        expect(shareBody([track({ name: 'a' }), track({ name: 'b' })]).split('/')).toHaveLength(2);
    });
});

describe('разметка маршрута в ссылке', () => {
    // waypoints on one straight line and an extra route point on the line: link simplification removes only that point
    const W0 = { lat: 0, lng: 0 };
    const W1 = { lat: 0, lng: 0.01 };
    const W2 = { lat: 0, lng: 0.02 };
    const R = [
        { lat: 0.001, lng: 0.002 },
        { lat: 0.001, lng: 0.005 },
        { lat: 0.001, lng: 0.008 },
    ];

    test('Открытие ссылки: опорные точки на прямой не пропадают, разметка — в теле', () => {
        const routed = track({
            segments: [[W0, ...R, W1, W2]],
            routes: [{ waypoints: [0, 4, 5], legs: [{ state: 'routed', activity: 'hiking' }, { state: 'straight' }] }],
        });
        const [parsed] = parseNktk(shareBody([routed]));
        expect(parsed.segments[0]).toHaveLength(5);
        expect(parsed.routes).toEqual([
            { waypoints: [0, 3, 4], legs: [{ state: 'routed', activity: 'hiking' }, { state: 'straight' }] },
        ]);
    });

    test('ломаная без разметки упрощается как раньше', () => {
        const [parsed] = parseNktk(shareBody([track({ segments: [[W0, W1, W2]] })]));
        expect(parsed.segments[0]).toHaveLength(2);
        expect(parsed.routes).toBeUndefined();
    });
});

describe('адрес ссылки', () => {
    const location = { origin: 'https://nakarte-routing.pages.dev', pathname: '/' };

    test('без q, r и параметров треков, nktl в конце', () => {
        expect(shareLink({ ...location, hash: '#m=10/41.7/44.8&q=tbilisi&l=O/Hs&r=41/44/x&nktk=abc&p=1' }, 'KEY')).toBe(
            'https://nakarte-routing.pages.dev/#m=10/41.7/44.8&l=O/Hs&p=1&nktl=KEY',
        );
    });
});

describe('запись в хранилище', () => {
    const url = `${TEST_STORAGE}/track/${CLIENT_KEY}`;

    test('200 — ключ', async () => {
        const { sources, requested } = fakeSources({ [url]: { body: '' } });
        await expect(storeTracks(CLIENT_BODY, sources)).resolves.toBe(CLIENT_KEY);
        expect(requested).toEqual([url]);
    });

    test('413 — track is too big', async () => {
        const { sources } = fakeSources({ [url]: { status: 413, body: '' } });
        await expect(storeTracks(CLIENT_BODY, sources)).rejects.toThrow(new ShareError('track is too big'));
    });

    test('сеть упала', async () => {
        await expect(storeTracks(CLIENT_BODY, fakeSources().sources)).rejects.toThrow(ShareError);
    });

    test('другая ошибка — код ответа', async () => {
        const { sources } = fakeSources({ [url]: { status: 429, body: '' } });
        await expect(storeTracks(CLIENT_BODY, sources)).rejects.toThrow('server responded with 429');
    });
});
