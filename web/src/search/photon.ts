import { browserLanguages, type PlaceQuery, RESULTS_LIMIT, SearchResponseError } from './mapycz';
import { PLACE_ZOOM, type SearchResult } from './result';

// The fallback search is photon.komoot.io directly (CORS *) when mapy.cz did not answer (design
// add-web-search-panoramas, «Поиск по названию»). The parsing is PhotonProvider of the old client
// (src/lib/leaflet.control.search/providers/photon.js): GeoJSON, extent is [west, north, east, south], without extent
// the zoom is 17 of the old client. The answer is fixtures/photon-mtatsminda.json.

export const PHOTON_URL = 'https://photon.komoot.io/api/';
export const PHOTON_ATTRIBUTION = { text: 'Photon by Komoot', url: 'https://photon.komoot.io/' };

const LANGUAGES = ['en', 'de', 'fr', 'it'];

export function photonUrl({ query, lat, lng, languages }: PlaceQuery): string {
    const url = new URL(PHOTON_URL);
    url.searchParams.append('limit', String(RESULTS_LIMIT));
    url.searchParams.append('q', query);
    // the old client calculated the browser language but sent en; here the calculated language goes
    url.searchParams.append('lang', browserLanguages(languages, LANGUAGES)[0] ?? 'en');
    url.searchParams.append('lat', String(lat));
    url.searchParams.append('lon', String(lng));
    return url.href;
}

interface PhotonFeature {
    geometry?: { coordinates?: number[] };
    properties?: {
        name?: string;
        street?: string;
        housenumber?: string;
        city?: string;
        state?: string;
        country?: string;
        extent?: number[];
        osm_key?: string;
        osm_value?: string;
    };
}

export function parsePhoton(json: unknown): SearchResult[] {
    const features = (json as { features?: unknown })?.features;
    if (!Array.isArray(features)) {
        throw new SearchResponseError('unexpected response');
    }
    return (features as PhotonFeature[]).flatMap((feature): SearchResult[] => {
        const [lng, lat] = feature.geometry?.coordinates ?? [];
        const properties = feature.properties ?? {};
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return [];
        }
        let address: string | null = [
            properties.street,
            properties.housenumber,
            properties.city,
            properties.state,
            properties.country,
        ]
            .filter(Boolean)
            .join(', ');
        let title = properties.name;
        if (!title) {
            title = address;
            address = null;
        }
        // osm_value "yes" says nothing, so use osm_key
        let category = properties.osm_value === 'yes' ? properties.osm_key : properties.osm_value;
        category = category?.replace(/_/gu, ' ');
        const extent =
            properties.extent?.length === 4 && properties.extent.every(Number.isFinite) ? properties.extent : null;
        return [
            {
                title,
                subtitle: [category, address].filter(Boolean).join(', ') || null,
                latlng: { lat, lng },
                bounds: extent
                    ? {
                          west: Math.min(extent[0], extent[2]),
                          east: Math.max(extent[0], extent[2]),
                          south: Math.min(extent[1], extent[3]),
                          north: Math.max(extent[1], extent[3]),
                      }
                    : null,
                zoom: extent ? null : PLACE_ZOOM,
            },
        ];
    });
}
