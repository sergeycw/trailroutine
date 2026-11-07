import type { Bounds } from '@/tracks/geometry';
import type { LatLng } from '@/tracks/model';

// A search result of any source (design add-web-search-panoramas, «Модули»). The map moves to bounds if they are
// present, otherwise to latlng with zoom; zoom is in MapLibre units (the old zoom − 1, the zoom pitfall in AGENTS.md).
export interface SearchResult {
    title: string;
    // the category and the address of the place; null for coordinates and links
    subtitle: string | null;
    latlng: LatLng;
    bounds: Bounds | null;
    zoom: number | null;
}

export type SearchResponse = { results: SearchResult[] } | { error: string };

// A track link (design search-track-links, «Результат-трек и выбор»): there is no point, the choice downloads the
// track by url
export interface TrackLinkResult {
    kind: 'track';
    title: string;
    subtitle: string;
    url: string;
}

export type SearchItem = SearchResult | TrackLinkResult;

export const isTrackLinkResult = (item: SearchItem): item is TrackLinkResult =>
    (item as Partial<TrackLinkResult>).kind === 'track';

// zoom 17 of the old client: a result without bounds from the search providers and coordinates
export const PLACE_ZOOM = 16;

// the zoom of the old client (Leaflet, the world at z0 is 256 px) → MapLibre zoom
export function fromLeafletZoom(zoom: number): number {
    return Math.max(0, zoom - 1);
}
