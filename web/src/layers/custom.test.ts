import { describe, expect, test, vi } from 'vitest';
import oldLinksText from '../state/fixtures/old-links.txt?raw';
import { CUSTOM_BOTTOM_ORDER, CUSTOM_TOP_ORDER } from './catalog';
import {
    type CustomLayerFields,
    checkCors,
    customLayerDef,
    parseCustomLayerCode,
    probeTileUrl,
    serializeCustomLayer,
    tileTemplates,
    unsupportedTokens,
} from './custom';

const PROXY = 'https://proxy.test/';
const OLD_CODES = [...new Set(oldLinksText.match(/-cs[A-Za-z0-9_=-]+/g) ?? [])];

const FIELDS: CustomLayerFields = {
    name: 'Custom',
    url: 'https://tiles.example.test/{z}/{x}/{y}.png',
    tms: false,
    scaleDependent: false,
    maxZoom: 18,
    isOverlay: true,
    isTop: true,
};

describe('код своего слоя', () => {
    test('в реальных ссылках есть свои слои', () => {
        expect(OLD_CODES.length).toBeGreaterThan(10);
    });

    test.each(OLD_CODES)('старый код разбирается и собирается обратно байт в байт: %s', (code) => {
        const fields = parseCustomLayerCode(code);
        expect(fields).not.toBeNull();
        expect(serializeCustomLayer(fields as CustomLayerFields)).toBe(code);
    });

    test('NZ50 из ссылки: TMS-оверлей под встроенными', () => {
        const nz = OLD_CODES.map(parseCustomLayerCode).find((fields) => fields?.name === 'NZ50');
        expect(nz).toMatchObject({ tms: true, maxZoom: 15, isOverlay: true, isTop: false });
    });

    test('не-ASCII в названии — через \\u, как у старого клиента', () => {
        const code = serializeCustomLayer({ ...FIELDS, name: 'Карта' });
        expect(atob(code.slice(3).replace(/-/g, '+').replace(/_/g, '/'))).toContain('"name":"\\u041a\\u0430');
        expect(parseCustomLayerCode(code)?.name).toBe('Карта');
    });

    test('без isTop — старый код, считается «над»', () => {
        const legacy = `-cs${btoa(JSON.stringify({ name: 'x', url: 'https://a/{z}/{x}/{y}', tms: false, maxZoom: 9, isOverlay: true }))}`;
        expect(parseCustomLayerCode(legacy)?.isTop).toBe(true);
    });

    test('corsProxy пишется только когда включён', () => {
        expect(atob(serializeCustomLayer(FIELDS).slice(3))).not.toContain('corsProxy');
        expect(parseCustomLayerCode(serializeCustomLayer({ ...FIELDS, corsProxy: true }))?.corsProxy).toBe(true);
    });

    test.each(['-csнеbase64', `-cs${btoa('[1]')}`, `-cs${btoa('{"name":"x"}')}`, 'O'])('битый код: %s', (code) => {
        expect(parseCustomLayerCode(code)).toBeNull();
    });
});

describe('шаблон адреса', () => {
    test('{s} — адреса по поддоменам abc, {r} — {ratio}', () => {
        expect(tileTemplates({ ...FIELDS, url: 'https://{s}.t.test/{z}/{x}/{y}{r}.png' }, PROXY)).toEqual({
            tiles: [
                'https://a.t.test/{z}/{x}/{y}{ratio}.png',
                'https://b.t.test/{z}/{x}/{y}{ratio}.png',
                'https://c.t.test/{z}/{x}/{y}{ratio}.png',
            ],
            scheme: 'xyz',
        });
    });

    test('{-y} и флаг tms — схема TMS', () => {
        expect(tileTemplates({ ...FIELDS, url: 'https://t.test/{z}/{x}/{-y}.png' }, PROXY)).toEqual({
            tiles: ['https://t.test/{z}/{x}/{y}.png'],
            scheme: 'tms',
        });
        expect(tileTemplates({ ...FIELDS, tms: true }, PROXY).scheme).toBe('tms');
    });

    test('через прокси — адрес в формате прокси клона', () => {
        expect(tileTemplates({ ...FIELDS, corsProxy: true }, PROXY).tiles).toEqual([
            'https://proxy.test/https/tiles.example.test/{z}/{x}/{y}.png',
        ]);
    });

    test('Неподдерживаемый шаблон: токены SAS Planet', () => {
        expect(unsupportedTokens('https://t.test/z{z_1}/{x_1024}/x{x}/{y_1024}/y{y}.png')).toEqual([
            '{z_1}',
            '{x_1024}',
            '{y_1024}',
        ]);
        expect(unsupportedTokens(FIELDS.url)).toEqual([]);
    });
});

describe('слой из полей', () => {
    test('место в порядке наложения — над или под встроенными оверлеями', () => {
        expect(customLayerDef('-csA', FIELDS, PROXY).order).toBe(CUSTOM_TOP_ORDER);
        expect(customLayerDef('-csA', { ...FIELDS, isTop: false }, PROXY).order).toBe(CUSTOM_BOTTOM_ORDER);
        expect(customLayerDef('-csA', { ...FIELDS, isOverlay: false }, PROXY)).toMatchObject({
            order: CUSTOM_BOTTOM_ORDER,
            isOverlay: false,
            title: 'Custom',
            source: { type: 'raster', maxzoom: 18, tileSize: 256, scheme: 'xyz' },
        });
    });

    test('пробный тайл — в центре вида, зум тайлов на 1 больше зума карты и не глубже maxZoom', () => {
        // Tbilisi, map zoom 14 → tile z15
        expect(probeTileUrl(FIELDS, { lat: 41.687, lng: 44.776 }, 14, PROXY)).toBe(
            'https://tiles.example.test/15/20459/12202.png',
        );
        expect(probeTileUrl({ ...FIELDS, maxZoom: 9 }, { lat: 41.687, lng: 44.776 }, 14, PROXY)).toBe(
            'https://tiles.example.test/9/319/190.png',
        );
        expect(probeTileUrl({ ...FIELDS, tms: true, maxZoom: 9 }, { lat: 41.687, lng: 44.776 }, 14, PROXY)).toBe(
            'https://tiles.example.test/9/319/321.png',
        );
    });
});

describe('Проверка CORS своего слоя', () => {
    test('CORS-запрос прошёл', async () => {
        const fetchImpl = vi.fn(async () => new Response(''));
        expect(await checkCors('https://t.test/1.png', fetchImpl)).toBe('ok');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    test('Сервер без CORS: cors упал, no-cors ответил', async () => {
        const fetchImpl = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
            if (init?.mode === 'cors') {
                throw new TypeError('Failed to fetch');
            }
            return new Response(null);
        });
        expect(await checkCors('https://t.test/1.png', fetchImpl)).toBe('no-cors');
    });

    test('сервер недоступен', async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError('Failed to fetch');
        });
        expect(await checkCors('https://t.test/1.png', fetchImpl)).toBe('unreachable');
    });
});
