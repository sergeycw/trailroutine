import { describe, expect, test } from 'vitest';
import { fixtureBytes } from '@/test/bytes';
import { loadFromUrl, matchTrackLink, nameFromUrl } from './import-url';
import type { GeoData } from './model';
import { saveNktk } from './nktk';
import { type FakeResponse, fakeSources, viaTestProxy } from './test-sources';

// Links and expectations are testcases of the old client (fixtures/services/expected/), service responses were
// recorded on 2026-10-08 (fixtures/README.md). The old test went to live services; here the network is fake.

const EXPECTED = import.meta.glob<{ query: string[]; geodata: ExpectedGeoData[] }>(
    './fixtures/services/expected/*.json',
    {
        import: 'default',
        eager: true,
    },
);
const RECORDED = import.meta.glob<string>('./fixtures/services/*.*', {
    query: '?bytes',
    import: 'default',
    eager: true,
});

interface ExpectedGeoData {
    name?: string;
    error?: string;
    tracks?: { lat: number; lng: number }[][];
    points?: { lat: number; lng: number; name: string }[];
}

function recorded(file: string, status = 200): FakeResponse {
    return { status, body: fixtureBytes(RECORDED[`./fixtures/services/${file}`]) };
}

const ST_API = 'https://api.sports-tracker.com/apiserver/v1/workouts';
const NOT_FOUND = { status: 404, body: '' };

function serviceResponses(): Record<string, FakeResponse> {
    const responses: Record<string, FakeResponse> = {};
    for (const id of ['3376100', '3376094', '3376096']) {
        responses[viaTestProxy(`https://www.openstreetmap.org/trace/${id}/data`)] = recorded(`osm-${id}.gpx`);
    }
    for (const id of ['3376095', '3376097', '33761000']) {
        responses[viaTestProxy(`https://www.openstreetmap.org/trace/${id}/data`)] = NOT_FOUND;
    }
    const sportsTracker: [string, string, number, number][] = [
        ['5f2d4cb86643bb7d5bdc599c', '5f2d4cb86643bb7d5bdc599c', 200, 200],
        ['5f2d7abe8fec9d7f9ce27b62', '5f2d7abe8fec9d7f9ce27b62', 200, 200],
        ['5f2d7bf6eefb8e23194d9d80', '5f2d7bf6eefb8e23194d9d80', 403, 403],
        // workouts that do not exist: the response is recorded for the first one, the others get the same one
        ['5f2d4cb86643bb7d5bdc599', '5f2d4cb86643bb7d5bdc599', 200, 404],
        ['5f2d4cb86643bb7d5bdc5991', '5f2d4cb86643bb7d5bdc599', 200, 404],
        ['5f2d4cb86643bb7d5bdc59912', '5f2d4cb86643bb7d5bdc599', 200, 404],
    ];
    for (const [id, file, dataStatus, metaStatus] of sportsTracker) {
        responses[viaTestProxy(`${ST_API}/${id}/data?samples=100000`)] = recorded(
            `sportstracker-${file}-data.json`,
            dataStatus,
        );
        responses[viaTestProxy(`${ST_API}/${id}/combined`)] = recorded(
            `sportstracker-${file}-combined.json`,
            metaStatus,
        );
    }
    const tracedetrail: [string, string][] = [
        ['https://tracedetrail.fr/en/trace/trace/125395', 'tracedetrail-125395.html'],
        ['https://tracedetrail.fr/en/trace/125395', 'tracedetrail-125395.html'],
        ['https://tracedetrail.fr/en/iframe/9577', 'tracedetrail-iframe-9577.html'],
        ['https://tracedetrail.fr/en/trace/trace/1253951', 'tracedetrail-1253951.html'],
        ['https://tracedetrail.fr/en/trace/trace/125397', 'tracedetrail-125397.html'],
    ];
    for (const [url, file] of tracedetrail) {
        responses[viaTestProxy(url)] = recorded(file);
    }
    return responses;
}

// As reduceSegmentsPointsPrecision of the old test: coordinates to 7 decimal places
function rounded(data: { name?: string; error?: string; segments: GeoData['segments']; points: GeoData['points'] }) {
    const round = ({ lat, lng }: { lat: number; lng: number }) => ({ lat: lat.toFixed(7), lng: lng.toFixed(7) });
    return {
        name: data.name ?? '',
        error: data.error,
        segments: data.segments.map((line) => line.map(round)),
        points: data.points.map((p) => ({ ...round(p), name: p.name })),
    };
}

const CASES = Object.entries(EXPECTED).flatMap(([file, { query, geodata }]) =>
    query.map((url) => ({ testcase: file.split('/').pop(), url, geodata })),
);

describe('сервисы импорта, ожидания старого клиента', () => {
    test.each(CASES)('$testcase: $url', async ({ url, geodata }) => {
        const { sources } = fakeSources(serviceResponses());
        const result = await loadFromUrl(url, sources);
        expect(result.map(rounded)).toEqual(
            geodata.map((old) =>
                rounded({
                    name: old.name,
                    error: old.error,
                    segments: old.tracks ?? [],
                    points: (old.points ?? []).map(({ lat, lng, name }) => ({ lat, lng, name })),
                }),
            ),
        );
    });
});

describe('сценарии', () => {
    test('Трек OSM: запрос идёт через прокси клона', async () => {
        const { sources, requested } = fakeSources(serviceResponses());
        const [track] = await loadFromUrl('https://www.openstreetmap.org/user/Wladich/traces/3376100', sources);
        expect(track.name).toBe('Test - Тест - Zkouška');
        expect(requested).toEqual([viaTestProxy('https://www.openstreetmap.org/trace/3376100/data')]);
    });

    test('Приватная тренировка Sports Tracker', async () => {
        const { sources } = fakeSources(serviceResponses());
        const [result] = await loadFromUrl(
            'https://sports-tracker.com/workout/yyryyy/5f2d7bf6eefb8e23194d9d80',
            sources,
        );
        expect(result.error).toBe('Sports Tracker user disabled viewing this activity');
        expect(result.segments).toEqual([]);
    });

    test('Файл по ссылке: название — имя файла', async () => {
        const url = 'https://example.test/files/My%20track.gpx?x=1';
        const { sources } = fakeSources({ [viaTestProxy(url)]: recorded('osm-3376094.gpx') });
        const [track] = await loadFromUrl(url, sources);
        expect(track.name).toBe('My track.gpx');
        expect(track.segments).toHaveLength(1);
    });

    test('Линейка Яндекса — без сети', async () => {
        const { sources, requested } = fakeSources();
        const [track] = await loadFromUrl('https://yandex.ru/maps/?ll=44.8,41.7&rl=44.8%2C41.7~0.01%2C0.02', sources);
        expect(track.name).toBe('Yandex ruler');
        expect(track.segments[0][1].lat).toBeCloseTo(41.72, 10);
        expect(track.segments[0][1].lng).toBeCloseTo(44.81, 10);
        expect(requested).toEqual([]);
    });

    test('ссылка nakarte с nktk', async () => {
        const nktk = saveNktk({
            name: 'Linked',
            segments: [
                [
                    { lat: 1, lng: 2 },
                    { lat: 3, lng: 4 },
                ],
            ],
            points: [],
        });
        const { sources } = fakeSources();
        const [track] = await loadFromUrl(`https://nakarte-routing.pages.dev/#m=5/1/2&nktk=${nktk}`, sources);
        expect(track.name).toBe('Linked');
    });

    test('Strava не поддерживается: страница — unsupported format', async () => {
        const url = 'https://www.strava.com/activities/123';
        const { sources } = fakeSources({ [viaTestProxy(url)]: { body: '<!doctype html><html></html>' } });
        expect(await loadFromUrl(url, sources)).toEqual([
            { name: '123', segments: [], points: [], error: 'UNSUPPORTED' },
        ]);
    });

    test('не ссылка — INVALID_URL', async () => {
        const { sources } = fakeSources();
        expect((await loadFromUrl('not a url', sources))[0].error).toBe('INVALID_URL');
    });

    test('сеть упала — NETWORK', async () => {
        const { sources } = fakeSources();
        expect((await loadFromUrl('https://example.test/a.gpx', sources))[0].error).toBe('NETWORK');
    });
});

describe('ссылка узнаётся без сети', () => {
    // the search box calls matchTrackLink on each letter (design search-track-links): the network is only in load
    test.each([
        ['https://yandex.ru/maps/?ll=44.8,41.7&rl=44.8%2C41.7~0.01%2C0.02', 'Yandex ruler', false],
        ['track://abc', 'Tracks from link', false],
        ['https://nakarte-routing.pages.dev/#m=5/1/2&nktl=abc', 'Tracks from link', false],
        ['https://www.openstreetmap.org/user/Wladich/traces/3376100', 'OSM track 3376100', false],
        ['https://tracedetrail.fr/en/trace/123', 'Tracedetrail track 123', false],
        ['https://sports-tracker.com/workout/yyryyy/5f2d7bf6eefb8e23194d9d80', 'Sports Tracker activity', false],
        ['https://example.test/files/My%20track.gpx?x=1', 'My track.gpx', true],
        ['https://nakarte-routing.pages.dev/#m=5/1/2', 'nakarte-routing.pages.dev', true],
    ])('%s', (url, title, file) => {
        expect(matchTrackLink(url)).toMatchObject({ title, file });
    });

    test('не ссылка', () => {
        expect(matchTrackLink('not a url')).toBeNull();
    });

    test('мусор после track:// — ошибка трека, а не исключение', async () => {
        const { sources } = fakeSources();
        for (const tail of ['!!!', 'AAAA', 'abc']) {
            const loaded = await matchTrackLink(`track://${tail}`)?.load(sources);
            expect(loaded?.length).toBeGreaterThan(0);
        }
    });
});

test.each([
    ['https://example.test/dir/track.gpx', 'track.gpx'],
    ['https://example.test/dir/', 'dir'],
    ['https://example.test/a%20b.kml#x', 'a b.kml'],
])('nameFromUrl %s', (url, name) => {
    expect(nameFromUrl(url)).toBe(name);
});
