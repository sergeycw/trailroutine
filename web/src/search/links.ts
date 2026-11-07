import { fromLeafletZoom, type SearchResponse, type SearchResult } from './result';

// Map links in the search bar: a port of LinksProvider of the old client
// (src/lib/leaflet.control.search/providers/links.js): Yandex, Google, mapy.com, OSM, nakarte. The zoom in links is
// the zoom of the old client (Leaflet), in the result it is MapLibre zoom. Short links goo.gl/maps, maps.app.goo.gl and mapy.com/s/
// expand with HEAD through the proxy of the clone; the final address of the answer is a proxy address, and the code
// removes the proxy prefix from it.

export interface LinkSources {
    fetch: typeof fetch;
    corsProxyUrl: string;
}

// makeSearchResult of the old client: a zoom above 18 of the old client is cut
const MAX_ZOOM = 18;

class InvalidLink extends Error {}

function result(lat: number, lng: number, zoom: number, title: string): SearchResult {
    if (
        [zoom, lat, lng].some(Number.isNaN) ||
        zoom < 0 ||
        zoom > 25 ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
    ) {
        throw new InvalidLink('Invalid view state value');
    }
    return {
        title,
        subtitle: null,
        latlng: { lat, lng },
        bounds: null,
        zoom: fromLeafletZoom(Math.min(zoom, MAX_ZOOM)),
    };
}

const malformed = (name: string) => ({ error: `Invalid coordinates in ${name} link` });
const brokenShort = (name: string) => ({ error: `Broken ${name} short link` });
// not a map link: the search bar offers to open it as a track file (design search-track-links)
export const UNSUPPORTED_LINK = 'Unsupported link';
const UNSUPPORTED = { error: UNSUPPORTED_LINK };

// the proxy address «<proxy>/https/host/path?q» → «https://host/path?q»; other addresses stay as they are
function unproxy(url: string, corsProxyUrl: string): URL {
    if (!url.startsWith(corsProxyUrl)) {
        return new URL(url);
    }
    return new URL(url.slice(corsProxyUrl.length).replace(/^(https?)\//u, '$1://'));
}

function viaProxy(url: URL, corsProxyUrl: string): string {
    return corsProxyUrl + url.href.replace(/^(https?):\/\//u, '$1/');
}

// HEAD through the proxy; the browser follows the proxy redirects itself, the final address is response.url
async function resolveShort(url: URL, sources: LinkSources): Promise<URL> {
    const response = await sources.fetch(viaProxy(url, sources.corsProxyUrl), { method: 'HEAD' });
    return unproxy(response.url || viaProxy(url, sources.corsProxyUrl), sources.corsProxyUrl);
}

function yandex(url: URL): SearchResponse {
    try {
        const [lng, lat] = (url.searchParams.get('ll') ?? '').split(',').map(Number.parseFloat);
        const zoom = Math.round(Number.parseFloat(url.searchParams.get('z') ?? ''));
        return { results: [result(lat, lng, zoom, 'Yandex map view')] };
    } catch {
        return malformed('Yandex');
    }
}

const GOOGLE_VIEW = /\/@([-\d.]+),([-\d.]+),(?:([\d.]+)([mz]))?/u;
const GOOGLE_PLACE = /\/place\/([^/]+)/u;
const GOOGLE_PLACE_ZOOM = 14;
const GOOGLE_PANORAMA_ZOOM = 16;

// /maps/place/<name>/@view/data=…!8m2!3d<lat>!4d<lng>: the place and the view are two results
function googleSimple(url: URL): SearchResult[] {
    const results: SearchResult[] = [];
    const path = url.pathname;
    const place = path.match(GOOGLE_PLACE);
    const placeCoordinates = path.match(/\/data=[^/]*!8m2!3d([-\d.]+)!4d([-\d.]+)/u);
    if (place && placeCoordinates) {
        try {
            const title = `Google map - ${decodeURIComponent(place[1]).replace(/\+/gu, ' ')}`;
            results.push(
                result(
                    Number.parseFloat(placeCoordinates[1]),
                    Number.parseFloat(placeCoordinates[2]),
                    GOOGLE_PLACE_ZOOM,
                    title,
                ),
            );
        } catch {
            // a place without valid coordinates: only the view
        }
    }
    const view = path.match(GOOGLE_VIEW);
    if (view) {
        try {
            const lat = Number.parseFloat(view[1]);
            const lng = Number.parseFloat(view[2]);
            let zoom: number;
            if (view[3] === undefined) {
                zoom = GOOGLE_PANORAMA_ZOOM;
            } else {
                zoom = Number.parseFloat(view[3]);
                // for the satellite, the scale is meters per screen, not a zoom
                if (view[4] === 'm') {
                    zoom = Math.log2((149175296 / zoom) * Math.cos((lat / 180) * Math.PI));
                }
                zoom = Math.round(zoom);
            }
            results.push(result(lat, lng, zoom, 'Google map view'));
        } catch {
            // an invalid view
        }
    }
    if (!results.length) {
        throw new InvalidLink('No results extracted from Google link');
    }
    return results;
}

// ?q=lat,lng or ?q=loc:lat,lng
function googleQuery(url: URL): SearchResult[] {
    const m = (url.searchParams.get('q') ?? '').match(/^(?:loc:)?([-\d.]+),([-\d.]+)$/u);
    if (!m) {
        throw new InvalidLink('No coordinates in Google query');
    }
    return [result(Number.parseFloat(m[1]), Number.parseFloat(m[2]), 17, 'Google map view')];
}

// Google sends requests from the proxy IP (Cloudflare Workers) to the captcha www.google.com/sorry/ with the answer
// 429, and puts the original address in the parameter continue. The code does not solve the captcha: it takes the
// address with the coordinates from there (resolveGoogleShortUrl of the old client)
function unsorry(url: URL): URL {
    const target = url.searchParams.get('continue');
    if (/^www\.google\.[a-z.]+$/u.test(url.hostname) && url.pathname.startsWith('/sorry/') && target) {
        return new URL(target);
    }
    return url;
}

// A link of a Google place with only a name and no coordinates (a maps.app.goo.gl share of a place often gives
// this): the search looks for the name instead (spec map-search, «Поиск по ссылкам на карты»)
export type LinkResponse = SearchResponse | { placeName: string };

async function google(url: URL, sources: LinkSources): Promise<LinkResponse> {
    const short = url.hostname === 'goo.gl' || url.hostname === 'maps.app.goo.gl';
    let actual: URL | null = url;
    if (short) {
        try {
            actual = unsorry(await resolveShort(url, sources));
        } catch {
            actual = null;
        }
    }
    // the parsers in turn, as subprocessors of the old client: an invalid view with ?q= is still parsed as a query
    const parsers: [(url: URL) => boolean, (url: URL) => SearchResult[]][] = [
        [(u) => GOOGLE_VIEW.test(u.pathname) || GOOGLE_PLACE.test(u.pathname), googleSimple],
        [(u) => u.searchParams.has('q'), googleQuery],
    ];
    for (const [ours, parse] of parsers) {
        if (actual && ours(actual)) {
            try {
                return { results: parse(actual) };
            } catch {
                // the next parser
            }
        }
    }
    const placeName = actual?.pathname.match(GOOGLE_PLACE)?.[1];
    if (placeName) {
        try {
            return { placeName: decodeURIComponent(placeName).replace(/\+/gu, ' ') };
        } catch {
            // a broken name: the error below
        }
    }
    return short ? brokenShort('Google') : malformed('Google');
}

async function mapy(url: URL, sources: LinkSources): Promise<SearchResponse> {
    const short = url.pathname.startsWith('/s/');
    try {
        let actual = url;
        if (short) {
            // Seznam broke the language subdomain after the move to mapy.com, so remove it (as the old client does)
            const bare = new URL(url.href);
            bare.host = bare.host.replace(/^[a-z]{2}\./u, '');
            actual = await resolveShort(bare, sources);
        }
        const lng = Number.parseFloat(actual.searchParams.get('x') ?? '');
        const lat = Number.parseFloat(actual.searchParams.get('y') ?? '');
        const zoom = Math.round(Number.parseFloat(actual.searchParams.get('z') ?? ''));
        return { results: [result(lat, lng, zoom, 'Mapy.com view')] };
    } catch {
        return short ? brokenShort('Mapy.com') : malformed('Mapy.com');
    }
}

function openStreetMap(url: URL): SearchResponse {
    // without map= in the fragment, it is not a view (a direct link to the GPX of an OSM track): the search bar offers
    // to open it as a file
    if (!/\bmap=/u.test(url.hash)) {
        return UNSUPPORTED;
    }
    const m = url.hash.match(/map=([\d.]+)\/([\d.-]+)\/([\d.-]+)/u);
    try {
        if (!m) {
            throw new InvalidLink('no map=');
        }
        const zoom = Math.round(Number.parseFloat(m[1]));
        return { results: [result(Number.parseFloat(m[2]), Number.parseFloat(m[3]), zoom, 'OpenStreetMap view')] };
    } catch {
        return malformed('OpenStreetMap');
    }
}

function nakarte(url: URL): SearchResponse {
    const m = url.hash.match(/\bm=([\d]+)\/([\d.-]+)\/([\d.-]+)/u);
    try {
        if (!m) {
            throw new InvalidLink('no m=');
        }
        const zoom = Math.round(Number.parseFloat(m[1]));
        return { results: [result(Number.parseFloat(m[2]), Number.parseFloat(m[3]), zoom, 'Nakarte view')] };
    } catch {
        return malformed('Nakarte');
    }
}

// track:// is a track link, the Track URL field understood it (design search-track-links)
export function isLinkQuery(query: string): boolean {
    return /^(https?|track):\/\//u.test(query);
}

export async function searchLink(query: string, sources: LinkSources): Promise<LinkResponse> {
    let url: URL;
    try {
        url = new URL(query);
    } catch {
        return { error: 'Invalid link' };
    }
    const host = url.hostname;
    if ((/\byandex\./u.test(host) && url.pathname.startsWith('/maps/')) || /static-maps\.yandex\./u.test(host)) {
        return yandex(url);
    }
    if (
        ((/\bgoogle\./u.test(host) || host === 'goo.gl') && /^\/maps(\/|$)/u.test(url.pathname)) ||
        host === 'maps.app.goo.gl'
    ) {
        return google(url, sources);
    }
    if (/\bmapy\.(cz|com)$/u.test(host)) {
        return mapy(url, sources);
    }
    if (/\bopenstreetmap\./u.test(host)) {
        return openStreetMap(url);
    }
    // any address with a valid m= is a nakarte link (isOurUrl of the old client: a nakarte host or a parse without an
    // error)
    const view = nakarte(url);
    if (/\bnakarte\b/u.test(host) || !('error' in view)) {
        return view;
    }
    return UNSUPPORTED;
}
