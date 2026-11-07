import { describe, expect, test } from 'vitest';
import { buildCatalog } from '@/layers/catalog';
import type { CustomLayerFields } from '@/layers/custom';
import { QUICK_BASE_GROUPS, QUICK_OVERLAY_GROUPS, quickTarget } from '@/layers/quick-layers';
import { EMPTY_SETTINGS } from '@/layers/settings';
import { createAppStore, savedSelection } from './store';

const catalog = buildCatalog({ pixelRatio: 1, language: 'en', corsProxyUrl: 'https://proxy.test/' });

function store(base = 'O') {
    return createAppStore({
        catalog,
        corsProxyUrl: 'https://proxy.test/',
        settings: EMPTY_SETTINGS,
        selection: { base, overlays: [] },
        view: { lat: 0, lng: 0, zoom: 1 },
    });
}

const OVERLAY: CustomLayerFields = {
    name: 'Custom',
    url: 'https://tiles.example.test/{z}/{x}/{y}.png',
    tms: false,
    scaleDependent: false,
    maxZoom: 18,
    isOverlay: true,
    isTop: true,
};

describe('выбор слоёв', () => {
    test('Сменить подложку: только подложки, оверлей подложкой не становится', () => {
        const s = store();
        s.getState().selectBase('Otm');
        expect(s.getState().selection.base).toBe('Otm');
        s.getState().selectBase('Wh');
        expect(s.getState().selection.base).toBe('Otm');
    });

    test('оверлей включается и выключается, подложка оверлеем не включается', () => {
        const s = store();
        s.getState().toggleOverlay('Wh');
        s.getState().toggleOverlay('E');
        expect(s.getState().selection.overlays).toEqual(['Wh']);
        s.getState().toggleOverlay('Wh');
        expect(s.getState().selection.overlays).toEqual([]);
    });
});

describe('свои слои', () => {
    test('Добавить свой слой: в списке, включён, с переводом шаблона', () => {
        const s = store();
        const code = s.getState().addCustomLayer(OVERLAY);
        expect(s.getState().settings.custom).toEqual([code]);
        expect(s.getState().selection.overlays).toEqual([code]);
        expect(s.getState().layers.get(code)?.source.tiles).toEqual(['https://tiles.example.test/{z}/{x}/{y}.png']);
    });

    test('новая подложка заменяет текущую', () => {
        const s = store();
        const code = s.getState().addCustomLayer({ ...OVERLAY, isOverlay: false });
        expect(s.getState().selection).toEqual({ base: code, overlays: [] });
    });

    test('изменение: новый код, включённый слой остаётся включённым, видимость в списке переезжает', () => {
        const s = store();
        const code = s.getState().addCustomLayer(OVERLAY);
        const next = s.getState().replaceCustomLayer(code, { ...OVERLAY, corsProxy: true });
        expect(next).not.toBe(code);
        expect(s.getState().settings.custom).toEqual([next]);
        expect(s.getState().settings.listed).toEqual({ [next]: true });
        expect(s.getState().selection.overlays).toEqual([next]);
        expect(s.getState().layers.get(next)?.source.tiles?.[0]).toMatch(/^https:\/\/proxy\.test\/https\//);
    });

    test('оверлей, ставший подложкой, выключается, как у старого клиента', () => {
        const s = store();
        const code = s.getState().addCustomLayer(OVERLAY);
        s.getState().replaceCustomLayer(code, { ...OVERLAY, isOverlay: false });
        expect(s.getState().selection).toEqual({ base: 'O', overlays: [] });
    });

    test('удалённая подложка — выбор возвращается к умолчанию', () => {
        const s = store();
        const code = s.getState().addCustomLayer({ ...OVERLAY, isOverlay: false });
        s.getState().removeCustomLayer(code);
        expect(s.getState().selection).toEqual({ base: 'Of', overlays: [] });
        expect(s.getState().layers.has(code)).toBe(false);
    });
});

describe('откат подложки', () => {
    test('OpenFreeMap недоступен: подложка OpenFreeMap уступает Tracestrack, оверлеи остаются', () => {
        const s = store('Of');
        s.getState().toggleOverlay('Hs');
        expect(s.getState().fallBackBase('Of')).toBe(true);
        expect(s.getState().selection).toEqual({ base: 'Tt', overlays: ['Hs'] });
        expect(s.getState().basemapFallback).toBe('Of');
        expect(savedSelection(s.getState())).toEqual({ base: 'Of', overlays: ['Hs'] });
    });

    test('Недоступны обе: дальше OpenStreetMap, сохраняется подложка, с которой начался откат', () => {
        const s = store('Of');
        s.getState().fallBackBase('Of');
        expect(s.getState().fallBackBase('Tt')).toBe(true);
        expect(s.getState().selection.base).toBe('O');
        expect(s.getState().basemapFallback).toBe('Of');
        expect(savedSelection(s.getState())).toEqual({ base: 'Of', overlays: [] });
        // OpenStreetMap has no fallback: its errors give a normal toast
        expect(s.getState().fallBackBase('O')).toBe(false);
        expect(s.getState().selection.base).toBe('O');
    });

    test('Нет ключа или квоты: подложка Tracestrack уступает OpenStreetMap, оверлеи остаются', () => {
        const s = store('Tt');
        s.getState().toggleOverlay('Hs');
        expect(s.getState().fallBackBase('Tt')).toBe(true);
        expect(s.getState().selection).toEqual({ base: 'O', overlays: ['Hs'] });
        expect(s.getState().basemapFallback).toBe('Tt');
        // the basemap that the fallback started from is saved
        expect(savedSelection(s.getState())).toEqual({ base: 'Tt', overlays: ['Hs'] });
    });

    test('ошибка тайлов прежней подложки после её смены не откатывает', () => {
        const s = store('E');
        expect(s.getState().fallBackBase('Tt')).toBe(false);
        expect(s.getState().selection.base).toBe('E');
        expect(s.getState().basemapFallback).toBeNull();
    });

    test('Выбор после отката: явная подложка и l= сбрасывают откат', () => {
        const s = store('Tt');
        s.getState().fallBackBase('Tt');
        s.getState().selectBase('E');
        expect(s.getState().basemapFallback).toBeNull();
        expect(savedSelection(s.getState())).toEqual({ base: 'E', overlays: [] });

        const o = store('Tt');
        o.getState().fallBackBase('Tt');
        o.getState().selectBase('O');
        expect(o.getState().basemapFallback).toBeNull();
        expect(savedSelection(o.getState())).toEqual({ base: 'O', overlays: [] });

        const t = store('Tt');
        t.getState().fallBackBase('Tt');
        t.getState().applyLayersParam({ selection: { base: 'O', overlays: [] }, custom: [] });
        expect(t.getState().basemapFallback).toBeNull();
        expect(savedSelection(t.getState())).toEqual({ base: 'O', overlays: [] });
    });

    test('после отката на другой подложке откат больше не при чём', () => {
        const s = store('Tt');
        s.getState().fallBackBase('Tt');
        const code = s.getState().addCustomLayer({ ...OVERLAY, isOverlay: false });
        expect(savedSelection(s.getState())).toEqual({ base: code, overlays: [] });
    });
});

describe('треки', () => {
    const tracksStore = store;
    const data = (name: string, fields = {}) => ({ name, segments: [], points: [], ...fields });

    test('цвет из ссылки сохраняется, без цвета — следующий по кругу', () => {
        const store = tracksStore();
        const added = store
            .getState()
            .addTracks([data('a'), data('b', { color: 4 }), data('c'), data('d', { color: 9 })]);
        expect(added.map((track) => track.color)).toEqual([0, 4, 1, 2]);
        expect(store.getState().addTracks([data('e')])[0].color).toBe(3);
    });

    test('видимость из ссылки, уникальные id', () => {
        const store = tracksStore();
        const [a, b] = store.getState().addTracks([data('a', { hidden: true }), data('b')]);
        expect([a.visible, b.visible]).toEqual([false, true]);
        expect(a.id).not.toBe(b.id);
    });

    test('правка и удаление', () => {
        const store = tracksStore();
        const [a, b] = store.getState().addTracks([data('a'), data('b')]);
        store.getState().updateTrack(a.id, { name: 'renamed', visible: false });
        expect(store.getState().tracks.map((t) => [t.name, t.visible])).toEqual([
            ['renamed', false],
            ['b', true],
        ]);
        store.getState().removeTracks([b.id]);
        expect(store.getState().tracks.map((t) => t.name)).toEqual(['renamed']);
    });
});

describe('Круг помнит выбор типа', () => {
    const maps = QUICK_BASE_GROUPS[1];

    test('откат не пишет память', () => {
        const s = store('Tt');
        s.getState().fallBackBase('Tt');
        expect(s.getState().settings.quickLayers).toEqual({});
        s.getState().selectBase('E');
        // the regular map circle: the fallback OpenStreetMap is not remembered, so the circle gives Google Map
        expect(quickTarget(maps, s.getState().settings.quickLayers, undefined, maps.codes)).toBe('G');
    });

    test('выбор подложки, оверлея и слои ссылки запоминаются, повтор не пишет настройки заново', () => {
        const s = store('Tt');
        s.getState().selectBase('I');
        s.getState().toggleOverlay('Sb');
        expect(s.getState().settings.quickLayers).toEqual({ E: 'I', Sa: 'Sb' });
        const settings = s.getState().settings;
        s.getState().selectBase('I');
        expect(s.getState().settings).toBe(settings);
        s.getState().applyLayersParam({ selection: { base: 'P', overlays: ['Sr', 'Hs'] }, custom: [] });
        expect(s.getState().settings.quickLayers).toEqual({ E: 'I', Sa: 'Sr', G: 'P' });
    });
});

describe('Меню слоёв столбца', () => {
    const heatmaps = QUICK_OVERLAY_GROUPS[0];

    test('оверлей группы столбца встаёт вместо остальных её оверлеев, null выключает группу', () => {
        const s = store('Tt');
        s.getState().toggleOverlay('Hs');
        s.getState().toggleOverlay('Sa');
        s.getState().toggleOverlay('Sw');
        s.getState().setQuickOverlay(heatmaps, 'Sr');
        expect(s.getState().selection.overlays).toEqual(['Hs', 'Sr']);
        expect(s.getState().settings.quickLayers).toEqual({ Sa: 'Sr' });
        s.getState().setQuickOverlay(heatmaps, null);
        expect(s.getState().selection.overlays).toEqual(['Hs']);
        expect(s.getState().settings.quickLayers).toEqual({ Sa: 'Sr' });
        // a layer not from the group: nothing changes
        s.getState().setQuickOverlay(heatmaps, 'Hs');
        expect(s.getState().selection.overlays).toEqual(['Hs']);
    });
});
