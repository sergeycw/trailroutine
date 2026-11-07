import { describe, expect, test } from 'vitest';
import { memoryStorage } from '@/test/memory-storage';
import { buildCatalog } from './catalog';
import { serializeCustomLayer } from './custom';
import { EMPTY_SETTINGS, isListed, LEGACY_STORAGE_KEY, loadSettings, STORAGE_KEY, saveSettings } from './settings';

const catalog = buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' });
const layer = (code: string) => catalog.find((item) => item.code === code) ?? catalog[0];

const OLD_CUSTOM = serializeCustomLayer({
    name: 'NZ50',
    url: 'http://tiles-4.topomap.co.nz/tiles-topo50-20181002/{z}-{x}-{y}.png',
    tms: true,
    scaleDependent: false,
    maxZoom: 15,
    isOverlay: true,
    isTop: false,
});

describe('Настройки старого клиента', () => {
    test('Сохранённые настройки со старыми кодами', () => {
        const legacy = {
            layers: [
                { code: 'T', isCustom: false, enabled: true, hotkey: null },
                { code: 'F', isCustom: false, enabled: true },
                { code: 'Wp', isCustom: false, enabled: true, hotkey: 'W' },
                { code: 'Co', isCustom: false, enabled: false, hotkey: null },
                // the hotkeys of the old client do not move: the new app does not have them
                { code: 'Otm', isCustom: false, enabled: true, hotkey: 'T' },
                { code: OLD_CUSTOM, isCustom: true, enabled: true, hotkey: '5' },
            ],
        };
        const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) });
        const settings = loadSettings(storage, catalog);
        expect(settings.listed).toEqual({ Co: false, Otm: true, [OLD_CUSTOM]: true });
        expect(settings).not.toHaveProperty('hotkeys');
        expect(settings.custom).toEqual([OLD_CUSTOM]);
        expect(isListed(layer('Co'), settings)).toBe(false);
        // the old key stays untouched: the old client lives on the same origin
        expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(JSON.stringify(legacy));
    });

    test('свой ключ важнее старого', () => {
        const storage = memoryStorage({
            [LEGACY_STORAGE_KEY]: JSON.stringify({ layers: [{ code: 'Co', enabled: false }] }),
        });
        saveSettings(storage, { ...EMPTY_SETTINGS, listed: { Co: true } });
        expect(loadSettings(storage, catalog).listed).toEqual({ Co: true });
    });

    test.each([
        ['битый JSON', 'not json'],
        ['не объект', '[1, 2]'],
        ['без layers', '{}'],
    ])('старые настройки: %s — умолчания', (_, raw) => {
        expect(loadSettings(memoryStorage({ [LEGACY_STORAGE_KEY]: raw }), catalog)).toEqual(EMPTY_SETTINGS);
    });

    test('битые свои настройки — пробуются старые', () => {
        const storage = memoryStorage({
            [STORAGE_KEY]: '{oops',
            [LEGACY_STORAGE_KEY]: JSON.stringify({ layers: [{ code: 'E', enabled: false }] }),
        });
        expect(loadSettings(storage, catalog).listed).toEqual({ E: false });
    });

    test('без хранилища и с хранилищем, которое бросает, — умолчания', () => {
        expect(loadSettings(null, catalog)).toEqual(EMPTY_SETTINGS);
        const throwing = {
            ...memoryStorage(),
            getItem: () => {
                throw new DOMException('denied', 'SecurityError');
            },
            setItem: () => {
                throw new DOMException('denied', 'SecurityError');
            },
        };
        expect(loadSettings(throwing, catalog)).toEqual(EMPTY_SETTINGS);
        expect(() => saveSettings(throwing, EMPTY_SETTINGS)).not.toThrow();
    });
});

describe('Выбор переживает перезагрузку', () => {
    test('свои настройки и последний выбор записываются и читаются обратно', () => {
        const storage = memoryStorage();
        const settings = {
            listed: { Co: false },
            custom: [OLD_CUSTOM],
            selection: { base: 'E', overlays: ['Hs'] },
            quickLayers: { E: 'I', Sa: 'Sr' },
        };
        saveSettings(storage, settings);
        expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? '')).toMatchObject({ version: 1, groupDefaults: true });
        expect(loadSettings(storage, catalog)).toEqual(settings);
    });
});

describe('умолчания каталога', () => {
    test('в списке — isDefault каталога, пока пользователь не решил иначе', () => {
        expect(isListed(layer('O'), EMPTY_SETTINGS)).toBe(true);
        expect(isListed(layer('Gbt'), EMPTY_SETTINGS)).toBe(false);
        expect(isListed(layer('Hs'), EMPTY_SETTINGS)).toBe(true);
        expect(isListed(layer('Gbt'), { ...EMPTY_SETTINGS, listed: { Gbt: true } })).toBe(true);
    });

    test('Слои меню отмечены по умолчанию', () => {
        expect(layer('Otm').isDefault).toBe(false);
        expect(isListed(layer('Otm'), EMPTY_SETTINGS)).toBe(true);
        expect(isListed(layer('Sr'), EMPTY_SETTINGS)).toBe(true);
        expect(isListed(layer('Nm'), EMPTY_SETTINGS)).toBe(false);
        expect(isListed(layer('Otm'), { ...EMPTY_SETTINGS, listed: { Otm: false } })).toBe(false);
    });
});

describe('Круг помнит выбор типа', () => {
    test('память столбца: настройки без поля — пустая, значения не строки отбрасываются', () => {
        const stored = (quickLayers?: unknown) =>
            memoryStorage({
                [STORAGE_KEY]: JSON.stringify({ version: 1, listed: {}, custom: [], selection: null, quickLayers }),
            });
        expect(loadSettings(stored(), catalog).quickLayers).toEqual({});
        expect(loadSettings(stored(['I']), catalog).quickLayers).toEqual({});
        expect(loadSettings(stored({ E: 'I', Tt: 5, G: null }), catalog).quickLayers).toEqual({ E: 'I' });
    });

    test('память круга топокарты из-под прежнего первого кода Tt переезжает под Of', () => {
        const stored = (quickLayers: unknown) =>
            memoryStorage({
                [STORAGE_KEY]: JSON.stringify({ version: 1, listed: {}, custom: [], selection: null, quickLayers }),
            });
        expect(loadSettings(stored({ Tt: 'Otm', E: 'I' }), catalog).quickLayers).toEqual({ Of: 'Otm', E: 'I' });
        // the new memory has priority over the old one
        expect(loadSettings(stored({ Tt: 'Otm', Of: 'Co' }), catalog).quickLayers).toEqual({ Of: 'Co' });
    });
});

describe('Настройка списка слоёв', () => {
    test('Старые настройки галочек', () => {
        const listed = { Otm: false, Sr: false, Co: false, Gbt: false, Nm: true };
        const stored = (extra: object) =>
            memoryStorage({
                [STORAGE_KEY]: JSON.stringify({ version: 1, listed, custom: [], selection: null, ...extra }),
            });
        // a record without groupDefaults wrote all check marks at once: "unchecked" for a group layer without
        // isDefault is the previous default
        expect(loadSettings(stored({}), catalog).listed).toEqual({ Co: false, Gbt: false, Nm: true });
        // with groupDefaults, "unchecked" is the user choice
        expect(loadSettings(stored({ groupDefaults: true }), catalog).listed).toEqual(listed);
        // the settings of the old client wrote the check marks of all layers: the same parsing
        const legacy = memoryStorage({
            [LEGACY_STORAGE_KEY]: JSON.stringify({
                layers: [
                    { code: 'Otm', enabled: false },
                    { code: 'Sr', enabled: false },
                    { code: 'Co', enabled: false },
                ],
            }),
        });
        expect(loadSettings(legacy, catalog).listed).toEqual({ Co: false });
    });
});
