import { closedTrackService, matchTrackLink } from '@/tracks/import-url';
import { isCoordinatesQuery, searchCoordinates } from './coordinates';
import { isLinkQuery, type LinkSources, searchLink, UNSUPPORTED_LINK } from './links';
import { MAPYCZ_ATTRIBUTION, mapyczUrl, type PlaceQuery, parseMapycz } from './mapycz';
import { PHOTON_ATTRIBUTION, parsePhoton, photonUrl } from './photon';
import type { SearchItem, TrackLinkResult } from './result';

// One search of a string (design add-web-search-panoramas, «Поиск по названию»): link → coordinates → mapy.cz through
// the proxy → photon directly, if mapy.cz did not answer. The cancel is signal (a new request cancels the previous
// one).

export const MIN_QUERY_LENGTH = 3;

export interface Attribution {
    text: string;
    url: string;
}

export type SearchOutcome =
    | { kind: 'results'; results: SearchItem[]; attribution: Attribution | null }
    | { kind: 'error'; message: string };

export interface SearchContext extends Omit<PlaceQuery, 'query'> {
    signal?: AbortSignal;
}

export type SearchSources = LinkSources;

class ServiceError extends Error {}

async function getJson(fetchFn: typeof fetch, url: string, signal: AbortSignal | undefined): Promise<unknown> {
    let response: Response;
    try {
        response = await fetchFn(url, { signal });
    } catch (error) {
        if (signal?.aborted) {
            throw error;
        }
        throw new ServiceError('network error');
    }
    if (!response.ok) {
        throw new ServiceError(`HTTP ${response.status}`);
    }
    try {
        return await response.json();
    } catch {
        throw new ServiceError('unexpected response');
    }
}

const outcome = (results: SearchItem[], attribution: Attribution | null): SearchOutcome =>
    results.length ? { kind: 'results', results, attribution } : { kind: 'error', message: 'Nothing found' };

export const OPEN_AS_TRACK = 'Open as track';

// the sources of track links: the services of tracks/import-url.ts and the map links of search/links.ts
export const SEARCH_HINT =
    'Search places and coordinates, or paste a link: a map of Google, Yandex, OpenStreetMap, mapy.cz or nakarte.me; ' +
    'a track of nakarte.me, Yandex ruler, OpenStreetMap traces, Tracedetrail or Sports Tracker; ' +
    'a GPX, KML, KMZ or GeoJSON file.';

// a link of a service that does not give its tracks (spec map-search, «Ссылки на треки в поиске»): what to do instead
export function closedServiceMessage(service: string): string {
    return `${service} does not share tracks with other sites. Download a GPX file in ${service}, then open it with Open file in Tracks.`;
}

// A link (design search-track-links, «Порядок разбора ссылки»): a track of a known source, then the map view from the
// same link; "any file" only if the link is not a track and not a map link. Here the track is only recognized, the
// choice downloads it
async function searchAnyLink(text: string, sources: SearchSources): Promise<SearchOutcome> {
    const closed = closedTrackService(text);
    if (closed) {
        return { kind: 'error', message: closedServiceMessage(closed) };
    }
    const track = matchTrackLink(text);
    // for "any file", the name from the path says little (data, 123), so the label has the host
    const subtitle = track?.file ? `${OPEN_AS_TRACK} · ${new URL(text).host}` : OPEN_AS_TRACK;
    const asTrack: TrackLinkResult[] = track ? [{ kind: 'track', title: track.title, subtitle, url: text }] : [];
    if (track && !track.file) {
        const view = /^https?:/u.test(text) ? await searchLink(text, sources) : null;
        return outcome([...asTrack, ...(view && 'results' in view ? view.results : [])], null);
    }
    const view = await searchLink(text, sources);
    if ('results' in view) {
        return outcome(view.results, null);
    }
    return view.error === UNSUPPORTED_LINK && asTrack.length
        ? outcome(asTrack, null)
        : { kind: 'error', message: view.error };
}

export async function search(query: string, context: SearchContext, sources: SearchSources): Promise<SearchOutcome> {
    const text = query.trim();
    if (isLinkQuery(text)) {
        return searchAnyLink(text, sources);
    }
    if (isCoordinatesQuery(text)) {
        const response = searchCoordinates(text);
        return 'error' in response ? { kind: 'error', message: response.error } : outcome(response.results, null);
    }
    const place = { ...context, query: text };
    try {
        const json = await getJson(sources.fetch, mapyczUrl(sources.corsProxyUrl, place), context.signal);
        return outcome(parseMapycz(json), MAPYCZ_ATTRIBUTION);
    } catch (error) {
        if (context.signal?.aborted) {
            throw error;
        }
    }
    try {
        const json = await getJson(sources.fetch, photonUrl(place), context.signal);
        return outcome(parsePhoton(json), PHOTON_ATTRIBUTION);
    } catch (error) {
        if (context.signal?.aborted) {
            throw error;
        }
        return { kind: 'error', message: `Search failed: ${(error as Error).message}` };
    }
}
