// The one place for the service addresses of the new app. The values are as in the old client
// (src/config.js + src/config-target/clone.js): the same Workers on *.nakarte-routing.workers.dev,
// and the clone is different only in the routing engine. The mode is the Vite mode: `vite build --mode clone`
// for the deploy, the other modes use the local server BRouter (docker-compose.yml).
const CORS_PROXY_URL = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev/';
const ELEVATION_SERVER_URL = 'https://nakarte-elevation.nakarte-routing.workers.dev/';

export type RoutingEngine = 'browser' | 'server';

export interface Config {
    defaultLocation: [lat: number, lng: number];
    defaultZoom: number;
    corsProxyUrl: string;
    elevationsServer: string;
    // the data attribution of the elevation service: the terms of viewfinderpanoramas.org require a link to the source
    // (elevationsAttribution of the old client, src/config.js)
    elevationsAttribution: { text: string; url: string };
    tracksStorageServer: string;
    routingEngine: RoutingEngine;
    routingEngineRuntimeUrl: string;
    routingServer: string;
    routingTilesPath: string;
    // the Maps JavaScript API key for the Street View window; empty means the mode without a key (design
    // add-web-search-panoramas, «Maps JavaScript API и ключ»). The deploy uses the secret GOOGLE_MAPS_API_KEY, the
    // same as the old client
    googleMapsApiKey: string;
    // the address of the Sentry project (DSN) of the error tracker; empty means the tracker is off (design
    // add-error-tracking, «Где хранится DSN»). The DSN is not a secret, it is visible in the bundle. The deploy uses
    // the secret SENTRY_DSN as a switch: without it, the build does not send anything to Sentry
    sentryDsn: string;
    // the site address after the move (change move-to-trailroutine-domain): the old address sends people here
    siteOrigin: string;
    // the hosts from which the app sends people to siteOrigin together with the browser data (move/move-out.ts).
    // Only the exact name: the deploys <hash>.nakarte-routing.pages.dev and a future staging site do not move
    movedFromHosts: readonly string[];
}

export function makeConfig(mode: string, googleMapsApiKey = '', sentryDsn = ''): Config {
    const clone = mode === 'clone';
    return {
        // the initial view without parameters in the address is the village Omalo in Tusheti (owner 2026-10-29,
        // design default-view-omalo; the coordinates are from the Wikipedia article Omalo, 42°22′44″N 45°37′48″E);
        // before, it was the view of the old client above Ukraine. The zoom is in MapLibre units: its world at z0 is
        // 512 px, in Leaflet 256 px, so the same scale is 1 less (Leaflet z13 = MapLibre 12, m=13 in the address).
        // The parse of m= from old links must subtract 1.
        defaultLocation: [42.37889, 45.63],
        defaultZoom: 12,
        corsProxyUrl: CORS_PROXY_URL,
        elevationsServer: ELEVATION_SERVER_URL,
        elevationsAttribution: {
            text: 'viewfinderpanoramas.org (Jonathan de Ferranti)',
            url: 'https://viewfinderpanoramas.org/dem3.html',
        },
        tracksStorageServer: 'https://nakarte-tracks.nakarte-routing.workers.dev',
        routingEngine: clone ? 'browser' : 'server',
        // the CheerpJ loader of the same version as in the old client: the Community license works only with this CDN
        routingEngineRuntimeUrl: 'https://cjrtnc.leaningtech.com/4.3/loader.js',
        routingServer: 'http://localhost:17777',
        // the clone reads the BRouter tiles from the same origin (functions/tiles), the local dev from the engine
        // test bench
        routingTilesPath: clone ? '/tiles/' : '/brouter-wasm/segments4/',
        googleMapsApiKey,
        sentryDsn,
        siteOrigin: 'https://trailroutine.com',
        movedFromHosts: ['nakarte-routing.pages.dev'],
    };
}

// import.meta.env exists only in the Vite build; e2e imports the module in Node for makeConfig, and without ?. the
// import would fail
export const config = makeConfig(
    import.meta.env?.MODE ?? '',
    import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ?? '',
    import.meta.env?.VITE_SENTRY_DSN ?? '',
);
