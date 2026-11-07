import { parseHash } from '@/state/hash';
import { isTrackParam, loadTrackParam } from './links';
import { type GeoData, geoData, type LatLng } from './model';
import { parseTrackUrlData } from './nktk';
import { parseGeoFile } from './parsers';
import { parseGpxText } from './parsers/gpx';
import { decodeXml } from './parsers/text';
import { fetchOrNull, proxied, type TrackSources } from './sources';

// Track import by link (services/ of the old client). The services go in its order, without Strava, Garmin Connect
// and Wikiloc (the owner's decision, archive record-new-ui-decisions): their links go to "any file" and give
// unsupported format. Everything that goes to an external site goes through the CORS proxy of the clone.
//
// A service recognizes a link without the network and downloads only after that (design search-track-links,
// «Порядок разбора ссылки»): the search box shows a track result on each letter, but downloads only the selected one.

export interface TrackLink {
    // name of the future track, if the service knows it in advance; the label of the search result
    title: string;
    // "any file over http(s)": the last option, search offers it only if the link is not a map link
    file: boolean;
    load(sources: TrackSources): Promise<GeoData[]> | GeoData[];
}

type Service = (url: string) => TrackLink | null;

const link = (title: string, load: TrackLink['load'], file = false): TrackLink => ({ title, file, load });

async function bytesOf(response: Response) {
    return new Uint8Array(await response.arrayBuffer());
}

// Yandex Maps ruler: rl= has points as deltas «lng,lat~lng,lat», without network requests
const yandexRuler: Service = (url) => {
    const match = /yandex\..+[?&]rl=([^&]+)/u.exec(url);
    if (!match) {
        return null;
    }
    return link('Yandex ruler', () => parseYandexRuler(match[1]));
};

function parseYandexRuler(rl: string): GeoData[] {
    const points: LatLng[] = [];
    let error: GeoData['error'];
    let lat = 0;
    let lng = 0;
    for (const pair of rl.replace(/%2C/giu, ',').split('~')) {
        const [dLng, dLat] = pair.split(',').map(Number.parseFloat);
        if (Number.isNaN(dLat) || Number.isNaN(dLng) || dLat === undefined) {
            error = 'CORRUPT';
            break;
        }
        lng += dLng;
        lat += dLat;
        points.push({ lat, lng });
    }
    return [geoData('Yandex ruler', { segments: [points], error })];
}

const TRACKS_FROM_LINK = 'Tracks from link';

const nakarteTrack: Service = (url) => {
    const index = url.indexOf('track://');
    if (index === -1) {
        return null;
    }
    // the search box shows a result for any string after track://: garbage gives a toast, not an exception
    return link(TRACKS_FROM_LINK, () => {
        try {
            return parseTrackUrlData(url.slice(index + 'track://'.length));
        } catch {
            return [geoData(TRACKS_FROM_LINK, { error: 'CORRUPT' })];
        }
    });
};

// nakarte link (of any address) with track parameters in #
const nakarteUrl: Service = (url) => {
    if (!url.includes('#')) {
        return null;
    }
    const params = [...parseHash(url)].filter(([key]) => isTrackParam(key));
    if (params.length === 0) {
        return null;
    }
    return link(TRACKS_FROM_LINK, (sources) =>
        Promise.all(
            params.map(([key, values]) => loadTrackParam(key as Parameters<typeof loadTrackParam>[0], values, sources)),
        ).then((loaded) => loaded.flat()),
    );
};

const osm: Service = (url) => {
    const match = /^https?:\/\/(?:www\.)?openstreetmap\.org\/user\/(?:.*)\/traces\/(\d+)/u.exec(url);
    if (!match) {
        return null;
    }
    const id = match[1];
    const name = `OSM track ${id}`;
    return link(name, async (sources) => {
        const response = await fetchOrNull(sources, proxied(sources, `https://www.openstreetmap.org/trace/${id}/data`));
        if (!response?.ok) {
            return [geoData(url, { error: 'NETWORK' })];
        }
        return (
            parseGpxText(decodeXml(await bytesOf(response)), name, true) ?? [geoData(name, { error: 'UNSUPPORTED' })]
        );
    });
};

// EPSG:3857 → latitude and longitude (SphericalMercator.unproject of Leaflet, R = 6 378 137 m)
function unprojectMercator(x: number, y: number): LatLng {
    const R = 6378137;
    const d = 180 / Math.PI;
    return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * d, lng: (x * d) / R };
}

const tracedetrail: Service = (url) => {
    const match = /^https?:\/\/(?:www\.)?tracedetrail\.[a-z]{2,}.*\/(?:trace\/trace|trace|iframe)\/([0-9]+)/u.exec(url);
    if (!match) {
        return null;
    }
    const title = `Tracedetrail track ${match[1]}`;
    return link(title, async (sources) => {
        let name = title;
        const response = await fetchOrNull(sources, proxied(sources, url));
        // the service gives a deleted track with code 500 and a page
        if (!response || ![200, 500].includes(response.status)) {
            return [geoData(url, { error: 'NETWORK' })];
        }
        const page = await response.text();
        const geometry = /geometry\s*:\s*"(.+)",\n/u.exec(page);
        if (!geometry) {
            let error = 'UNSUPPORTED';
            if (page.includes("track doesn't exist") || response.status === 500) {
                error = '{name} was deleted or did not exist';
            } else if (page.includes('Private track')) {
                error = '{name} is private';
            }
            return [geoData(name, { error })];
        }
        const pageTitle = /<title>.+:\s*(.+)<\/title>/u.exec(page);
        if (pageTitle) {
            name = pageTitle[1];
        }
        try {
            const items = JSON.parse(geometry[1].replaceAll('\\"', '"')) as { lon: number; lat: number }[];
            return [geoData(name, { segments: [items.map((item) => unprojectMercator(item.lon, item.lat))] })];
        } catch {
            return [geoData(name, { error: 'UNSUPPORTED' })];
        }
    });
};

interface SportsTrackerData {
    payload: { description?: string; locations: { la: number; ln: number }[] };
}
interface SportsTrackerMeta {
    payload: { startTime: number; fullname: string };
}

const sportsTracker: Service = (url) => {
    const match = /^https?:\/\/(www\.)?sports-tracker\.com\/workout\/([^/]+)\/([a-z0-9]+)/u.exec(url);
    if (!match) {
        return null;
    }
    const api = `https://api.sports-tracker.com/apiserver/v1/workouts/${match[3]}`;
    return link('Sports Tracker activity', async (sources) => {
        const [data, meta] = await Promise.all([
            fetchOrNull(sources, proxied(sources, `${api}/data?samples=100000`)),
            fetchOrNull(sources, proxied(sources, `${api}/combined`)),
        ]);
        if (!data || !meta || ![200, 403].includes(data.status) || ![200, 403, 404].includes(meta.status)) {
            return [geoData(url, { error: 'NETWORK' })];
        }
        if (meta.status === 404) {
            return [geoData('', { error: 'Sports Tracker activity not found' })];
        }
        if (data.status === 403) {
            return [geoData('', { error: 'Sports Tracker user disabled viewing this activity' })];
        }
        let name = 'Sports Tracker activity';
        let dataJson: SportsTrackerData;
        let metaJson: SportsTrackerMeta;
        try {
            dataJson = await data.json();
            metaJson = await meta.json();
        } catch {
            return [geoData(name, { error: 'UNSUPPORTED' })];
        }
        const points = dataJson.payload.locations.map((location) => ({ lat: location.la, lng: location.ln }));
        if (dataJson.payload.description) {
            name = dataJson.payload.description;
        } else {
            name = `${metaJson.payload.fullname} on ${new Date(metaJson.payload.startTime).toDateString()}`;
        }
        return [geoData(name, { segments: [points] })];
    });
};

// nameFromUrl of the old client: the last path segment without # and ?
export function nameFromUrl(url: string): string {
    let decoded = url;
    try {
        decoded = decodeURIComponent(url);
    } catch {
        // keep it as it is
    }
    return decoded.split('#')[0].split('?')[0].replace(/\/*$/u, '').split('/').pop() ?? decoded;
}

// Any file over http(s): the format comes from the content
const anyFile: Service = (url) => {
    if (!/^https?:\/\/.+/u.test(url)) {
        return null;
    }
    return link(
        nameFromUrl(url),
        async (sources) => {
            const response = await fetchOrNull(sources, proxied(sources, url));
            if (!response?.ok) {
                return [geoData(url, { error: 'NETWORK' })];
            }
            return parseGeoFile(nameFromUrl(response.url || url), await bytesOf(response));
        },
        true,
    );
};

const SERVICES: Service[] = [yandexRuler, nakarteTrack, nakarteUrl, osm, tracedetrail, sportsTracker, anyFile];

// Services whose tracks do not open by link (checked 2026-11-07, change explain-track-link-sources): Strava, Garmin
// Connect and Wikiloc need a login or a browser (the owner's decision, archive record-new-ui-decisions), plotaroute
// answers non-browser requests with a bot check, MapMagic has private routes and GPX export only in PRO. The search
// names them instead of trying "any file".
const CLOSED_SERVICES: [string, RegExp][] = [
    ['Strava', /^https?:\/\/(?:[a-z0-9-]+\.)?strava\.(?:com|app\.link)\//u],
    ['Garmin Connect', /^https?:\/\/connect\.garmin\.(?:com|cn)\//u],
    ['Wikiloc', /^https?:\/\/(?:[a-z0-9-]+\.)?wikiloc\.com\//u],
    ['plotaroute', /^https?:\/\/(?:www\.)?plotaroute\.com\//u],
    ['MapMagic', /^https?:\/\/(?:[a-z0-9-]+\.)?mapmagic\.app\//u],
];

// the name of a service that does not give its tracks by link, or null; no network
export function closedTrackService(url: string): string | null {
    return CLOSED_SERVICES.find(([, pattern]) => pattern.test(url))?.[0] ?? null;
}

// the first service that recognizes the link; no network
export function matchTrackLink(url: string): TrackLink | null {
    for (const service of SERVICES) {
        const found = service(url);
        if (found) {
            return found;
        }
    }
    return null;
}

export async function loadFromUrl(url: string, sources: TrackSources): Promise<GeoData[]> {
    const found = matchTrackLink(url);
    return found ? found.load(sources) : [geoData(url, { error: 'INVALID_URL' })];
}
