import type { MapRef } from '@vis.gl/react-maplibre';
import { type ComponentProps, createRef } from 'react';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { App } from '@/App';
import { PROFILE_LAYERS } from '@/elevation/style';
import { CONTOUR_PROTOCOL } from '@/layers/catalog';
import { contourProtocol } from '@/layers/contours';
import { maplibre } from '@/map/maplibre';
import { EDIT_LAYERS } from '@/routing/edit-style';
import { TRACK_LAYERS } from '@/tracks/style';
import { fakeStreetView } from './fake-street-view';
import { memoryAutosave } from './memory-autosave';
import type { FixtureTiles } from './tiles';

// Сеть треков в browser-тестах: без заглушки любой запрос хранилища или прокси — ошибка сети (в сеть тесты не ходят)
const NO_NETWORK: typeof fetch = async (input) => {
    throw new TypeError(`no network in tests: ${String(input)}`);
};

interface RenderOptions {
    fetch?: typeof fetch;
    writeClipboard?: ComponentProps<typeof App>['writeClipboard'];
    router?: ComponentProps<typeof App>['router'];
    // хранилище автосохранения; по умолчанию — своё пустое в памяти на каждый рендер: рендеры App в одной странице
    // не видят треков друг друга, а общий IndexedDB страницы тестов не засоряется
    autosave?: ComponentProps<typeof App>['autosave'];
    // Street View: по умолчанию поддельный без панорам — в Google тесты не ходят
    streetView?: ComponentProps<typeof App>['streetView'];
    notice?: ComponentProps<typeof App>['notice'];
    // список треков открыт после загрузки (по умолчанию да): в приложении он закрыт до кнопки Tracks (макет 4a, design
    // polish-web-ui), а тестам списка и редактора он нужен открытым
    tracksOpen?: boolean;
}

// Кнопка списка треков верхней строки: «Tracks» и число треков
export const tracksButton = () => page.getByRole('button', { name: /^Tracks( \d+)?$/ });

// Открыть список треков, если закрыт
export async function openTracks() {
    const button = tracksButton();
    await expect.element(button).toBeVisible();
    if (button.element().getAttribute('aria-expanded') !== 'true') {
        await button.click();
    }
    await expect.element(page.getByTestId('track-list')).toBeVisible();
}

// Горизонтали в browser-тестах: боевой обработчик протокола грузит рельеф из Blob-воркера мимо transformRequest, то есть
// в сеть, тестовый — на главном потоке через фикстуру. Протокол глобальный: ставить перед каждым рендером App
export async function fixtureContours(tiles: FixtureTiles) {
    (await maplibre).addProtocol(CONTOUR_PROTOCOL, contourProtocol(tiles.transformRequest));
}

// App с подменёнными тайлами и готовой картой. hash — адрес страницы до старта приложения (m=, l= …).
export async function renderApp(tiles: FixtureTiles, hash = '', options: RenderOptions = {}) {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
    await fixtureContours(tiles);
    const mapRef = createRef<MapRef>();
    const screen = await render(
        <App
            transformRequest={tiles.transformRequest}
            mapRef={mapRef}
            fetch={options.fetch ?? NO_NETWORK}
            writeClipboard={options.writeClipboard}
            router={options.router}
            autosave={options.autosave === undefined ? memoryAutosave() : options.autosave}
            streetView={options.streetView ?? fakeStreetView([]).api}
            notice={options.notice}
        />,
    );
    await expect.poll(() => mapRef.current?.getMap().loaded(), { timeout: 10_000 }).toBe(true);
    if (options.tracksOpen !== false) {
        await openTracks();
    }
    // biome-ignore lint/style/noNonNullAssertion: карта загружена строкой выше
    return { screen, map: mapRef.current!.getMap() };
}

const ALWAYS_THERE = new Set([
    'background',
    ...[...PROFILE_LAYERS, ...TRACK_LAYERS, ...EDIT_LAYERS].map((layer) => layer.id),
]);

// слой стиля векторной подложки или горизонталей — `<код>-<имя>` (Of-water, Ct-labels; layers/outdoor.ts, style.ts):
// тесты слоёв проверяют, какие слои каталога на карте, а не устройство их стиля. Код каталога — с заглавной буквы: свои
// слои (-cs…) и служебные (street-view-coverage) правило не трогает
const STYLE_LAYER_OF_CODE = /^([A-Z][A-Za-z0-9]*)-[a-z]/;

// коды слоёв карты снизу вверх, без серого фона, слоёв профиля высот, треков и редактора (они есть всегда,
// layers/style.ts); слои стиля одного кода подряд — один код
export function mapLayerIds(map: { getStyle(): { layers: { id: string }[] } }) {
    const codes = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => !ALWAYS_THERE.has(id))
        .map((id) => STYLE_LAYER_OF_CODE.exec(id)?.[1] ?? id);
    return codes.filter((code, index) => code !== codes[index - 1]);
}
