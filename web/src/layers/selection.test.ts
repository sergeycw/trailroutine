import { describe, expect, test } from 'vitest';
import oldLinksText from '../state/fixtures/old-links.txt?raw';
import { parseHash } from '../state/hash';
import { buildCatalog, type LayerDef } from './catalog';
import { type CustomLayerFields, customLayerDef, parseCustomLayerCode, serializeCustomLayer } from './custom';
import { BASEMAP_FALLBACKS, DEFAULT_SELECTION, formatLayersParam, parseLayersParam, validSelection } from './selection';

const catalog = buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' });
const byCode = new Map(catalog.map((layer) => [layer.code, layer]));
const OLD_LINKS = oldLinksText.split('\n').filter((line) => line.startsWith('http'));

const CUSTOM_OVERLAY = serializeCustomLayer({
    name: 'gugk 56',
    url: 'https://ngw.fppd.cgkipd.ru/tile/56/{z}/{x}/{y}.png',
    tms: false,
    scaleDependent: false,
    maxZoom: 14,
    isOverlay: true,
    isTop: false,
});

function layers(param: string) {
    return parseLayersParam(parseHash(`#${param}`).get('l'), byCode);
}

describe('Слои в адресе', () => {
    test('Ссылка со слоями', () => {
        expect(layers('l=Otm/Wp')).toEqual({ selection: { base: 'Otm', overlays: [] }, custom: [] });
        expect(layers('l=Co/Wh')).toEqual({ selection: { base: 'Co', overlays: ['Wh'] }, custom: [] });
    });

    test.each(['l=O/F', 'l=O/Wp', 'l=O/K', 'l=O/M,', 'l=E/B/Ng'])('Ссылка с удалённым слоем: %s', (param) => {
        expect(layers(param)?.selection.overlays).toEqual([]);
    });

    test.each(['l=F', 'l=Y', 'l=Czt', 'l=M', 'l=О', 'l=T', 'l=', 'm=8/1/2'])(
        'Ссылка только с удалённым слоем: %s — l= игнорируется',
        (param) => {
            expect(layers(param)).toBeNull();
        },
    );

    test('Ссылка с Sentinel-2', () => {
        const parsed = layers('l=S2/Hs');
        expect(parsed).toEqual({ selection: { base: 'S2', overlays: ['Hs'] }, custom: [] });
        expect(formatLayersParam(parsed?.selection ?? DEFAULT_SELECTION, byCode)).toEqual(['S2', 'Hs']);
    });

    test('Горизонтали из рельефа: ссылка с l=O/Ct', () => {
        const parsed = layers('l=O/Ct/Hs');
        expect(parsed).toEqual({ selection: { base: 'O', overlays: ['Ct', 'Hs'] }, custom: [] });
        // the address has the catalog stacking order: the hillshade is under the contour lines
        expect(formatLayersParam(parsed?.selection ?? DEFAULT_SELECTION, byCode)).toEqual(['O', 'Hs', 'Ct']);
    });

    test('Ссылка со своим слоем', () => {
        expect(layers(`l=O/${CUSTOM_OVERLAY}`)).toEqual({
            selection: { base: 'O', overlays: [CUSTOM_OVERLAY] },
            custom: [CUSTOM_OVERLAY],
        });
    });

    test('свой слой-подложка годится как подложка', () => {
        const base = serializeCustomLayer({
            name: 'Base',
            url: 'https://t.test/{z}/{x}/{y}.png',
            tms: false,
            scaleDependent: false,
            maxZoom: 18,
            isOverlay: false,
            isTop: true,
        });
        expect(layers(`l=${base}`)?.selection.base).toBe(base);
    });

    test('все реальные ссылки разбираются без ошибок; годные дают известную подложку', () => {
        let valid = 0;
        for (const link of OLD_LINKS) {
            const parsed = parseLayersParam(parseHash(link).get('l'), byCode);
            if (!parsed) {
                continue;
            }
            valid++;
            const base = byCode.get(parsed.selection.base) ?? null;
            const custom = parseCustomLayerCode(parsed.selection.base);
            expect(base?.isOverlay === false || custom?.isOverlay === false, link).toBe(true);
        }
        expect(valid).toBeGreaterThan(30);
    });

    test('сборка l=: подложка, затем оверлеи по порядку наложения', () => {
        const all = new Map<string, LayerDef>(byCode);
        all.set(
            CUSTOM_OVERLAY,
            customLayerDef(CUSTOM_OVERLAY, parseCustomLayerCode(CUSTOM_OVERLAY) as CustomLayerFields, ''),
        );
        expect(formatLayersParam({ base: 'E', overlays: ['Sa', CUSTOM_OVERLAY, 'Hs', 'Nm'] }, all)).toEqual([
            'E',
            // isTop: false — the place #custom-bottom, under the built-in overlays
            CUSTOM_OVERLAY,
            'Nm',
            'Hs',
            'Sa',
        ]);
    });
});

describe('Откат подложки при ошибке тайлов', () => {
    test('цепочка OpenFreeMap Outdoor → Tracestrack Topo → OpenStreetMap, дальше отката нет', () => {
        expect(BASEMAP_FALLBACKS).toEqual({ Of: 'Tt', Tt: 'O' });
        for (const code of Object.values(BASEMAP_FALLBACKS)) {
            expect(byCode.get(code)?.isOverlay, code).toBe(false);
        }
        expect(BASEMAP_FALLBACKS.O).toBeUndefined();
        expect(BASEMAP_FALLBACKS.E).toBeUndefined();
    });
});

describe('сохранённый выбор', () => {
    test('пропавшие слои отбрасываются, без подложки — по умолчанию', () => {
        // the default basemap is OpenFreeMap Outdoor (spec map-layers, «Подложка по умолчанию»)
        expect(DEFAULT_SELECTION).toEqual({ base: 'Of', overlays: [] });
        expect(validSelection(null, byCode)).toEqual(DEFAULT_SELECTION);
        expect(validSelection({ base: 'Y', overlays: ['W', 'Hs', 'Hs', 'O'] }, byCode)).toEqual({
            base: 'Of',
            overlays: ['Hs'],
        });
        expect(validSelection({ base: 'E', overlays: [] }, byCode)).toEqual({ base: 'E', overlays: [] });
    });
});
