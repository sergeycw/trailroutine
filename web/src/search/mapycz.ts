import { PLACE_ZOOM, type SearchResult } from './result';

// mapy.cz search (MapyCzProvider of the old client, src/lib/leaflet.control.search/providers/mapycz): suggestions of
// pro.mapy.cz/suggest/ through the CORS proxy of the clone. The answer is saved in fixtures/mapycz-mtatsminda.json
// (2026-10-09): result[].userData with suggestFirstRow (the name), suggestSecondRow (the category and the address in
// the language lang), latitude, longitude and bbox [lat, lng, lat, lng]. The category icons (api.mapy.cz/poiimg) and
// the category table of the old client are not necessary: the second row already has the category (design
// add-web-search-panoramas, «Поиск по названию»).

export const MAPYCZ_SUGGEST_URL = 'https://pro.mapy.cz/suggest/';
export const MAPYCZ_ATTRIBUTION = { text: 'Mapy.com', url: 'https://mapy.com' };

const LANGUAGES = ['en', 'cs', 'de', 'pl', 'sk', 'ru', 'es', 'fr'];
export const RESULTS_LIMIT = 5;

// the browser languages from the supported ones, without repeats (getRequestLanguages of the old client)
export function browserLanguages(languages: readonly string[], supported: readonly string[]): string[] {
    const codes = languages.map((lang) => lang.split('-')[0]).filter((lang) => supported.includes(lang));
    return [...new Set(codes)];
}

export interface PlaceQuery {
    query: string;
    lat: number;
    lng: number;
    // MapLibre zoom
    zoom: number;
    languages: readonly string[];
}

export function mapyczUrl(corsProxyUrl: string, { query, lat, lng, zoom, languages }: PlaceQuery): string {
    const url = new URL(MAPYCZ_SUGGEST_URL);
    url.searchParams.append('phrase', query);
    url.searchParams.append('lat', String(lat));
    url.searchParams.append('lon', String(lng));
    // the zoom of the old client: mapy.cz expects it
    url.searchParams.append('zoom', String(Math.round(zoom + 1)));
    // in the old client, without matching languages the parameter was empty; the interface is English, so use en
    url.searchParams.append('lang', browserLanguages(languages, LANGUAGES).join(',') || 'en');
    url.searchParams.append('count', String(RESULTS_LIMIT));
    return corsProxyUrl + url.href.replace(/^https:\/\//u, 'https/');
}

interface MapyczItem {
    userData?: {
        suggestFirstRow?: string;
        suggestSecondRow?: string;
        suggestThirdRow?: string;
        latitude?: number;
        longitude?: number;
        bbox?: number[];
    };
}

export class SearchResponseError extends Error {}

export function parseMapycz(json: unknown): SearchResult[] {
    const items = (json as { result?: unknown })?.result;
    if (!Array.isArray(items)) {
        throw new SearchResponseError('unexpected response');
    }
    return (items as MapyczItem[])
        .map((item) => item.userData)
        .filter((data) => data && data.suggestSecondRow !== 'Poloha')
        .flatMap((data): SearchResult[] => {
            const lat = Number(data?.latitude);
            const lng = Number(data?.longitude);
            if (!data || !Number.isFinite(lat) || !Number.isFinite(lng)) {
                return [];
            }
            const bbox = data.bbox?.length === 4 && data.bbox.every(Number.isFinite) ? data.bbox : null;
            return [
                {
                    title: data.suggestFirstRow ?? '',
                    subtitle: data.suggestSecondRow || data.suggestThirdRow || null,
                    latlng: { lat, lng },
                    bounds: bbox
                        ? {
                              south: Math.min(bbox[0], bbox[2]),
                              north: Math.max(bbox[0], bbox[2]),
                              west: Math.min(bbox[1], bbox[3]),
                              east: Math.max(bbox[1], bbox[3]),
                          }
                        : null,
                    zoom: bbox ? null : PLACE_ZOOM,
                },
            ];
        });
}
