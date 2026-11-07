import {
    createExpression,
    type Formatted,
    latest,
    type StylePropertySpecification,
    validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, test } from 'vitest';
import { labelLanguage, labelText, outdoorLayers, peakText } from './outdoor';

// The object properties come from OpenFreeMap tiles (planet 20261004_113936_pt), decoded on 2026-10-12: z14 at
// Stepantsminda and z12 at Kazbek (design add-vector-outdoor-style, «Что проверено»)
const STEPANTSMINDA = {
    class: 'town',
    name: 'სტეფანწმინდა',
    'name:latin': 'Stepantsminda',
    'name:en': 'Stepantsminda',
    'name:ru': 'Степанцминда',
    'name:ka': 'სტეფანწმინდა',
};
const UPPER_LARS = { class: 'hamlet', name: 'Верхний Ларс', 'name:latin': 'Verkhniy Lars', 'name:ru': 'Верхний Ларс' };
const KAZBEK = {
    class: 'peak',
    name: 'მყინვარწვერი - Казбек',
    'name:latin': 'Kazbegi',
    'name:en': 'Kazbegi',
    'name:ru': 'Казбек',
    ele: 5054,
};
const KAZBEK_PASS = { class: 'saddle', name: 'Kazbekskiy pass', 'name:latin': 'Kazbekskiy pass', ele: 4478 };
// no Latin script and no translation: only the local name
const PASTUKHOVA = { class: 'peak', name: 'Пастухова', ele: 4312 };

const TEXT_FIELD = latest.layout_symbol['text-field'] as unknown as StylePropertySpecification;

// label lines: the format sections are joined and split at line breaks
function lines(expression: unknown, properties: Record<string, unknown>): string[] {
    const parsed = createExpression(expression, 'text-field', TEXT_FIELD);
    if (parsed.result !== 'success') {
        throw new Error(JSON.stringify(parsed.value));
    }
    const value = parsed.value.evaluate({ zoom: 14 }, { type: 'Point', properties } as never) as Formatted;
    return value.toString().split('\n');
}

describe('Подписи OpenFreeMap Outdoor', () => {
    test('Браузер на русском в Грузии', () => {
        expect(lines(labelText('ru-RU'), STEPANTSMINDA)).toEqual(['სტეფანწმინდა', 'Степанцминда']);
    });

    test('Нет перевода на язык браузера', () => {
        // Stepantsminda has no name:fi, so the second line is in Latin script
        expect(lines(labelText('fi-FI'), STEPANTSMINDA)).toEqual(['სტეფანწმინდა', 'Stepantsminda']);
        expect(lines(labelText('en-US'), STEPANTSMINDA)).toEqual(['სტეფანწმინდა', 'Stepantsminda']);
    });

    test('Название уже на языке браузера', () => {
        expect(lines(labelText('ru-RU'), UPPER_LARS)).toEqual(['Верхний Ларс']);
        expect(lines(labelText('ka-GE'), STEPANTSMINDA)).toEqual(['სტეფანწმინდა']);
        expect(lines(labelText('ru-RU'), PASTUKHOVA)).toEqual(['Пастухова']);
    });

    test('без местного названия — одна строка перевода', () => {
        expect(lines(labelText('ru'), { 'name:ru': 'Казбек' })).toEqual(['Казбек']);
    });

    test('язык — основной подтег navigator.language', () => {
        expect(labelLanguage('ru-RU')).toBe('ru');
        expect(labelLanguage('EN')).toBe('en');
    });
});

describe('Подложка OpenFreeMap Outdoor', () => {
    test('Вершина с высотой', () => {
        expect(lines(peakText('ru-RU'), KAZBEK)).toEqual(['მყინვარწვერი - Казбек', 'Казбек', '▲ 5054 m']);
        expect(lines(peakText('en-US'), KAZBEK_PASS)).toEqual(['Kazbekskiy pass', ')( 4478 m']);
        expect(lines(peakText('en-US'), { class: 'peak' })).toEqual(['▲']);
        expect(lines(peakText('en-US'), { class: 'peak', ele: 2494.3 })).toEqual(['▲ 2494 m']);
    });

    test('стиль проходит проверку спецификации, без glyphs, sprite и значков', () => {
        const layers = outdoorLayers('Of', 'ru-RU');
        const style = {
            version: 8 as const,
            sources: { Of: { type: 'vector' as const, url: 'https://tiles.openfreemap.org/planet' } },
            layers,
        };
        expect(validateStyleMin(style)).toEqual([]);
        expect(JSON.stringify(layers)).not.toMatch(/icon-image|glyphs|sprite/);
        // the land background is first, the labels are above the lines
        expect(layers[0].type).toBe('background');
        expect(layers.findIndex((layer) => layer.type === 'symbol')).toBeGreaterThan(
            layers.findLastIndex((layer) => layer.type !== 'symbol'),
        );
        for (const layer of layers) {
            expect(layer.id.startsWith('Of-')).toBe(true);
        }
    });
});
