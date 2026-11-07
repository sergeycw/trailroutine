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

// The track network in browser tests: without a stub, each request to the storage or the proxy is a network error
// (the tests do not use the network)
const NO_NETWORK: typeof fetch = async (input) => {
    throw new TypeError(`no network in tests: ${String(input)}`);
};

interface RenderOptions {
    fetch?: typeof fetch;
    writeClipboard?: ComponentProps<typeof App>['writeClipboard'];
    router?: ComponentProps<typeof App>['router'];
    // the autosave storage; by default, a new empty in-memory storage for each render: renders of App on one page
    // do not see the tracks of each other, and the shared IndexedDB of the test page stays clean
    autosave?: ComponentProps<typeof App>['autosave'];
    // Street View: by default, a fake one without panoramas, because the tests do not go to Google
    streetView?: ComponentProps<typeof App>['streetView'];
    notice?: ComponentProps<typeof App>['notice'];
    // the track list is open after the load (by default, yes): in the app it is closed until the Tracks button
    // (mock-up 4a, design polish-web-ui), but the tests of the list and the editor need it open
    tracksOpen?: boolean;
}

// The track list button of the top bar: «Tracks» and the number of tracks
export const tracksButton = () => page.getByRole('button', { name: /^Tracks( \d+)?$/ });

// Open the track list if it is closed
export async function openTracks() {
    const button = tracksButton();
    await expect.element(button).toBeVisible();
    if (button.element().getAttribute('aria-expanded') !== 'true') {
        await button.click();
    }
    await expect.element(page.getByTestId('track-list')).toBeVisible();
}

// Contours in browser tests: the production protocol handler loads the terrain from a Blob worker past
// transformRequest, that is, from the network. The test handler loads it on the main thread through the fixture. The
// protocol is global: set it before each render of App
export async function fixtureContours(tiles: FixtureTiles) {
    (await maplibre).addProtocol(CONTOUR_PROTOCOL, contourProtocol(tiles.transformRequest));
}

// App with replaced tiles and a ready map. hash is the page address before the app starts (m=, l= …).
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
    // biome-ignore lint/style/noNonNullAssertion: the line above waits until the map loads
    return { screen, map: mapRef.current!.getMap() };
}

const ALWAYS_THERE = new Set([
    'background',
    ...[...PROFILE_LAYERS, ...TRACK_LAYERS, ...EDIT_LAYERS].map((layer) => layer.id),
]);

// a style layer of the vector basemap or of the contours is `<code>-<name>` (Of-water, Ct-labels; layers/outdoor.ts,
// style.ts): the layer tests check which catalog layers are on the map, not how their style is made. A catalog code
// starts with a capital letter: the rule does not touch the custom layers (-cs…) and the service layers
// (street-view-coverage)
const STYLE_LAYER_OF_CODE = /^([A-Z][A-Za-z0-9]*)-[a-z]/;

// the codes of the map layers from bottom to top, without the gray background and the layers of the elevation
// profile, the tracks and the editor (they are always there, layers/style.ts); consecutive style layers of one code
// give one code
export function mapLayerIds(map: { getStyle(): { layers: { id: string }[] } }) {
    const codes = map
        .getStyle()
        .layers.map((layer) => layer.id)
        .filter((id) => !ALWAYS_THERE.has(id))
        .map((id) => STYLE_LAYER_OF_CODE.exec(id)?.[1] ?? id);
    return codes.filter((code, index) => code !== codes[index - 1]);
}
