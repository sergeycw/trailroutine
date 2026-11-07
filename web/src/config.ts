// Одно место адресов сервисов нового приложения. Значения — как у старого клиента
// (src/config.js + src/config-target/clone.js): те же Worker'ы на *.nakarte-routing.workers.dev,
// клон отличается только движком прокладки. Режим — режим Vite: `vite build --mode clone` для деплоя,
// остальные режимы — локальный серверный BRouter (docker-compose.yml).
const CORS_PROXY_URL = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev/';
const ELEVATION_SERVER_URL = 'https://nakarte-elevation.nakarte-routing.workers.dev/';

export type RoutingEngine = 'browser' | 'server';

export interface Config {
    defaultLocation: [lat: number, lng: number];
    defaultZoom: number;
    corsProxyUrl: string;
    elevationsServer: string;
    // атрибуция данных сервиса высот: условия viewfinderpanoramas.org требуют ссылку на источник (elevationsAttribution
    // старого клиента, src/config.js)
    elevationsAttribution: { text: string; url: string };
    tracksStorageServer: string;
    routingEngine: RoutingEngine;
    routingEngineRuntimeUrl: string;
    routingServer: string;
    routingTilesPath: string;
    // ключ Maps JavaScript API для окна Street View; пустой — режим без ключа (design add-web-search-panoramas, «Maps
    // JavaScript API и ключ»). В деплое — секрет GOOGLE_MAPS_API_KEY, тот же, что у старого клиента
    googleMapsApiKey: string;
    // адрес проекта Sentry (DSN) трекера ошибок; пустой — трекер выключен (design add-error-tracking, «Где хранится
    // DSN»). DSN не секрет, он виден в бандле; в деплое — секрет SENTRY_DSN ради выключателя: без него сборка к Sentry
    // не обращается
    sentryDsn: string;
    // адрес сайта после переезда (change move-to-trailroutine-domain): сюда старый адрес переводит людей
    siteOrigin: string;
    // хосты, с которых приложение переводит людей на siteOrigin вместе с данными браузера (move/move-out.ts).
    // Только точное имя: деплои <хеш>.nakarte-routing.pages.dev и будущий стенд не переезжают
    movedFromHosts: readonly string[];
}

export function makeConfig(mode: string, googleMapsApiKey = '', sentryDsn = ''): Config {
    const clone = mode === 'clone';
    return {
        // начальный вид без параметров в адресе — село Омало в Тушети (владелец 2026-10-29, design default-view-omalo;
        // координаты — статья Omalo в Википедии, 42°22′44″N 45°37′48″E); раньше — вид старого клиента над Украиной.
        // Зум — в единицах MapLibre: у него мир на z0 512 px, у Leaflet 256 px, поэтому тот же масштаб на 1 меньше
        // (Leaflet z13 = MapLibre 12, m=13 в адресе). Разбор m= из старых ссылок обязан вычитать 1.
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
        // загрузчик CheerpJ той же версии, что у старого клиента: лицензия Community работает только с этим CDN
        routingEngineRuntimeUrl: 'https://cjrtnc.leaningtech.com/4.3/loader.js',
        routingServer: 'http://localhost:17777',
        // клон читает тайлы BRouter с того же origin (functions/tiles), локальный dev — со стенда движка
        routingTilesPath: clone ? '/tiles/' : '/brouter-wasm/segments4/',
        googleMapsApiKey,
        sentryDsn,
        siteOrigin: 'https://trailroutine.com',
        movedFromHosts: ['nakarte-routing.pages.dev'],
    };
}

// import.meta.env есть только в сборке Vite; e2e импортирует модуль в Node ради makeConfig, и без ?. импорт падал бы
export const config = makeConfig(
    import.meta.env?.MODE ?? '',
    import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ?? '',
    import.meta.env?.VITE_SENTRY_DSN ?? '',
);
