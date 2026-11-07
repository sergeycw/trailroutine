import { PbfReader, PbfWriter } from 'pbf';
import { describe, expect, test } from 'vitest';
import type { SegmentRoute } from '@/routing/line';
import oldLinksText from '@/state/fixtures/old-links.txt?raw';
import { parseHash } from '@/state/hash';
import reference from './fixtures/nktk-old.json';
import type { GeoData } from './model';
import {
    ARC_UNIT,
    decodeBase64Url,
    encodeBase64Url,
    parseNktk,
    parseNktkSequence,
    parseTrackUrlData,
    saveNktk,
} from './nktk';

// Reference: strings written by the encoders of the old client, and their parsing by the old parseNktkFragment
// (fixtures/nktk-old.json): v4 is saveNktk, v3 and v2 are saveToString from the upstream history (7534e57^, f339a82^),
// v1 and v0 (track://) are the v2 string without points, with version 1 and without a version.

interface OldGeoData {
    name: string;
    error?: string[];
    tracks?: { lat: number; lng: number }[][];
    points?: { lat: number; lng: number; name: string }[];
    color: number;
    measureTicksShown: number | boolean;
    trackHidden: boolean;
}

function fromOld(old: OldGeoData): GeoData {
    return {
        name: old.name,
        segments: old.tracks ?? [],
        points: old.points ?? [],
        color: old.color,
        measureTicksShown: Boolean(old.measureTicksShown),
        hidden: old.trackHidden,
        ...(old.error ? { error: 'CORRUPT' } : {}),
    };
}

describe('строки старого клиента', () => {
    test.each(reference.cases)('версия $version: $nktk', ({ version, nktk, decoded }) => {
        const parsed = version === 0 ? parseTrackUrlData(nktk) : parseNktk(nktk);
        expect(parsed).toEqual((decoded as OldGeoData[]).map(fromOld));
    });

    test('последовательность через /', () => {
        expect(parseNktkSequence(reference.sequence.nktk)).toEqual(
            (reference.sequence.decoded as OldGeoData[]).map(fromOld),
        );
    });

    test('Трек в адресе: nktk из реальной ссылки', () => {
        const link = oldLinksText.split('\n').find((line) => line.includes('nktk='));
        const [track] = parseNktk(parseHash(link ?? '').get('nktk')?.[0] ?? '');
        expect(track.error).toBeUndefined();
        expect(track.name).not.toBe('');
    });
});

describe('запись версии 4', () => {
    const track = {
        name: 'Тест трек',
        segments: [
            [
                { lat: 41.69, lng: 44.8 },
                { lat: -41.72, lng: -144.83 },
            ],
        ],
        points: [{ lat: 41.69, lng: 44.79, name: 'Перевал' }],
        color: 2,
        measureTicksShown: true,
        hidden: true,
    };

    test('совпадает со старым saveNktk байт в байт', () => {
        const [oldV4] = reference.cases;
        expect(oldV4.version).toBe(4);
        const decoded = fromOld((oldV4.decoded as OldGeoData[])[0]);
        expect(saveNktk(decoded)).toBe(oldV4.nktk);
    });

    test('запись → чтение — тот же трек на сетке ARC_UNIT', () => {
        const [parsed] = parseNktk(saveNktk(track));
        const grid = (value: number) => Math.round(value * ARC_UNIT) / ARC_UNIT;
        expect(parsed).toEqual({
            ...track,
            segments: track.segments.map((line) => line.map((p) => ({ lat: grid(p.lat), lng: grid(p.lng) }))),
            points: track.points.map((p) => ({ ...p, lat: grid(p.lat), lng: grid(p.lng) })),
        });
    });

    test('пустой трек — как старый', () => {
        expect(saveNktk({ name: '', segments: [], points: [] })).toBe(reference.cases[5].nktk);
    });
});

describe('Любой цвет в ссылке', () => {
    const track = { name: 'Цвет', segments: [], points: [{ lat: 41.69, lng: 44.79, name: 'P' }] };

    // the color field of the View message, as a client without the rgb field reads it (pbf skips unknown fields)
    function viewColor(nktk: string): number {
        // the first byte is the string version
        const pbf = new PbfReader((decodeBase64Url(nktk) as Uint8Array).slice(1));
        let color = 0;
        pbf.readFields((tag, _, reader) => {
            if (tag === 1) {
                reader.readFields(
                    (viewTag, __, view) => {
                        if (viewTag === 1) color = view.readVarint(true);
                    },
                    null,
                    reader.readVarint() + reader.pos,
                );
            }
        }, null);
        return color;
    }

    test.each(['#14b8a6', '#000000', '#ffffff'])('Ссылка со своим цветом: %s', (color) => {
        const [parsed] = parseNktk(saveNktk({ ...track, color }));
        expect(parsed.color).toBe(color);
        expect(parsed.error).toBeUndefined();
    });

    test('Читатель без поля rgb', () => {
        expect(viewColor(saveNktk({ ...track, color: '#14b8a6' }))).toBe(2);
    });

    // a version 4 string with View { color: 2, shown, rgb }: rgb is written as it is, without the saveNktk checks
    function withRgb(write: (view: PbfWriter) => void): string {
        const pbf = new PbfWriter();
        pbf.writeMessage(
            1,
            (_: null, view: PbfWriter) => {
                view.writeVarintField(1, 2);
                view.writeBooleanField(2, true);
                write(view);
            },
            null,
        );
        pbf.writeMessage(2, (_: null, out: PbfWriter) => out.writeStringField(1, 'Цвет'), null);
        const body = pbf.finish();
        return encodeBase64Url(Uint8Array.from([4 + 64, ...body]));
    }

    test.each([
        ['строкой', (view: PbfWriter) => view.writeStringField(4, '#14b8a6')],
        ['вне 0xRRGGBB', (view: PbfWriter) => view.writeVarintField(4, 0x1000000)],
    ])('поле rgb %s — цвет палитры из color', (_, write) => {
        const [parsed] = parseNktk(withRgb(write));
        expect(parsed.error).toBeUndefined();
        expect(parsed.color).toBe(2);
    });

    test('Цвет палитры в ссылке', () => {
        const nktk = saveNktk({ ...track, color: 3 });
        expect(viewColor(nktk)).toBe(3);
        expect(parseNktk(nktk)[0].color).toBe(3);
        // a palette color has no rgb field: a custom color with the same index in color is longer exactly by field 4
        // (the tag and 3 bytes)
        const bytes = (text: string) => decodeBase64Url(text)?.length ?? 0;
        expect(bytes(saveNktk({ ...track, color: '#14b8a6' }))).toBe(bytes(saveNktk({ ...track, color: 2 })) + 4);
    });
});

describe('разметка маршрута в строке', () => {
    // the points are on the ARC_UNIT grid already: write → read does not move them
    const grid = (lat: number, lng: number) => ({
        lat: Math.round(lat * ARC_UNIT) / ARC_UNIT,
        lng: Math.round(lng * ARC_UNIT) / ARC_UNIT,
    });
    const routed = [
        grid(41.69, 44.78),
        grid(41.691, 44.781),
        grid(41.692, 44.783),
        grid(41.7, 44.79),
        grid(41.71, 44.8),
    ];
    const route: SegmentRoute = {
        waypoints: [0, 3, 4],
        legs: [
            { state: 'routed', activity: 'hiking' },
            { state: 'failed', activity: 'mtb' },
        ],
    };
    const plain = [grid(41.6, 44.7), grid(41.61, 44.72)];

    test('Открытие ссылки: разметка отрезков читается обратно', () => {
        const [parsed] = parseNktk(
            saveNktk({ name: 'R', segments: [routed, plain], points: [], routes: [route, null] }),
        );
        expect(parsed.segments).toEqual([routed, plain]);
        expect(parsed.routes).toEqual([route, null]);
    });

    test('Ссылка без маршрута: та же строка, что без разметки', () => {
        const base = { name: 'R', segments: [routed], points: [] };
        expect(saveNktk({ ...base, routes: [null] })).toBe(saveNktk(base));
        expect(parseNktk(saveNktk(base))[0].routes).toBeUndefined();
    });

    test('Ссылка во время прокладки: ожидающий отрезок пишется непроложенным', () => {
        const pending: SegmentRoute = { waypoints: [0, 1], legs: [{ state: 'pending', activity: 'gravel' }] };
        const [parsed] = parseNktk(saveNktk({ name: 'R', segments: [plain], points: [], routes: [pending] }));
        expect(parsed.routes).toEqual([{ waypoints: [0, 1], legs: [{ state: 'failed', activity: 'gravel' }] }]);
    });

    test('разметка, которая не сходится с точками, не пишется', () => {
        const wrong: SegmentRoute = { waypoints: [0, 7], legs: [{ state: 'routed', activity: 'mtb' }] };
        expect(saveNktk({ name: 'R', segments: [routed], points: [], routes: [wrong] })).toBe(
            saveNktk({ name: 'R', segments: [routed], points: [] }),
        );
    });

    // a string written by hand: markup with gaps steps and legs codes over the routed segment
    function withRawRoute(gaps: number[], legs: number[], activities: string[]) {
        const pbf = new PbfWriter();
        pbf.writeMessage(1, (_: null, out: PbfWriter) => out.writeBooleanField(2, true), null);
        pbf.writeMessage(
            2,
            (_: null, out: PbfWriter) => {
                out.writeStringField(1, 'R');
                out.writeMessage(
                    2,
                    (__: null, segment: PbfWriter) => {
                        let lat = 0;
                        let lng = 0;
                        const lats = routed.map((p) => {
                            const value = Math.round(p.lat * ARC_UNIT) - lat;
                            lat += value;
                            return value;
                        });
                        const lons = routed.map((p) => {
                            const value = Math.round(p.lng * ARC_UNIT) - lng;
                            lng += value;
                            return value;
                        });
                        segment.writePackedSVarint(1, lats);
                        segment.writePackedSVarint(2, lons);
                        segment.writeMessage(
                            3,
                            (___: null, out3: PbfWriter) => {
                                out3.writePackedVarint(1, gaps);
                                out3.writePackedVarint(2, legs);
                                for (const activity of activities) out3.writeStringField(3, activity);
                            },
                            null,
                        );
                    },
                    null,
                );
            },
            null,
        );
        const body = pbf.finish();
        const bytes = new Uint8Array(body.length + 1);
        bytes[0] = 4 + 64;
        bytes.set(body, 1);
        return encodeBase64Url(bytes);
    }

    test('строка, записанная руками, читается так же', () => {
        expect(parseNktk(withRawRoute([3, 1], [1, 4], ['hiking', 'mtb']))[0].routes).toEqual([route]);
    });

    test('разметка из одних прямых не пишется и не читается', () => {
        const straight: SegmentRoute = { waypoints: [0, 1], legs: [{ state: 'straight' }] };
        expect(saveNktk({ name: 'R', segments: [plain], points: [], routes: [straight] })).toBe(
            saveNktk({ name: 'R', segments: [plain], points: [] }),
        );
        expect(parseNktk(withRawRoute([3, 1], [0, 0], []))[0].routes).toBeUndefined();
    });

    test.each([
        ['не тот тип поля', (out: PbfWriter) => out.writeVarintField(3, 5)],
        ['оборванное число внутри', (out: PbfWriter) => out.writeBytesField(3, new Uint8Array([0x0a, 0x02, 0xff]))],
    ])('битое поле разметки (%s) — геометрия открывается', (_, writeBroken) => {
        const pbf = new PbfWriter();
        pbf.writeMessage(1, (__: null, out: PbfWriter) => out.writeBooleanField(2, true), null);
        pbf.writeMessage(
            2,
            (__: null, out: PbfWriter) => {
                out.writeMessage(
                    2,
                    (___: null, segment: PbfWriter) => {
                        segment.writePackedSVarint(1, [100, 1]);
                        segment.writePackedSVarint(2, [200, 1]);
                        writeBroken(segment);
                    },
                    null,
                );
            },
            null,
        );
        const body = pbf.finish();
        const bytes = new Uint8Array(body.length + 1);
        bytes[0] = 4 + 64;
        bytes.set(body, 1);
        const [parsed] = parseNktk(encodeBase64Url(bytes));
        expect(parsed.error).toBeUndefined();
        expect(parsed.segments[0]).toHaveLength(2);
        expect(parsed.routes).toBeUndefined();
    });

    test.each([
        ['шагов больше, чем точек', [3, 5], [1, 0], ['hiking']],
        ['прямой отрезок с точками внутри', [4], [0], []],
        ['код вне таблицы активностей', [3, 1], [1, 5], ['hiking']],
        ['шагов и кодов поровну нет', [3, 1], [1], ['hiking']],
    ])('негодная разметка (%s) — трек без неё', (_, gaps, legs, activities) => {
        const [parsed] = parseNktk(withRawRoute(gaps, legs, activities));
        expect(parsed.error).toBeUndefined();
        expect(parsed.segments).toEqual([routed]);
        expect(parsed.routes).toBeUndefined();
    });
});

describe('испорченные строки', () => {
    test.each(['', '!!!', 'Zg', 'RA', 'Q1HQotC1'])('%s — CORRUPT без исключения', (text) => {
        const parsed = parseNktk(text);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].error).toBe('CORRUPT');
    });
});
