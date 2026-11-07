import { DATE_TOKEN, type LayerDef, type LayerSource, YEAR_TOKEN } from './catalog';

// Dated imagery (design add-dated-imagery): the date in the address, the capture dates over a point from STAC Earth
// Search and the default date. The module has no React and no store: the network is the given fetch, "today" is the
// given date (tests).

// d=YYYY-MM-DD: neither the old client nor the upstream use the key d (enableHashState in src/ of the old client)
export const DATE_PARAM = 'd';

// STAC API of Element 84 (https://earth-search.aws.element84.com/v1): CORS *, no key; it declares fields and sort of
// item-search
export const EARTH_SEARCH_URL = 'https://earth-search.aws.element84.com/v1/search';
// In 90 days, Kazbegi has 65 scenes of both collections, Tromsø 195, Svalbard 266 (the orbits overlap near the pole):
// one page up to 500; with more, only old dates are lost, because the sort is by date, descending
const SEARCH_LIMIT = 500;
export const DATES_DAYS = 90;
// HLS comes out 2–3 days after the capture (https://www.earthdata.nasa.gov/data/projects/hls): a newer Earth Search
// date can still be missing in GIBS, and then the tiles are transparent
export const HLS_LATENCY_DAYS = 3;
// the scene cloud cover (eo:cloud_cover, for a 110 km square or a 185 km Landsat scene) at which the date counts as
// clear
export const CLEAR_CLOUD_COVER = 20;
// the first L30 date in the GIBS WMTSCapabilities: there are no HLS images before it
export const FIRST_DATE = '2013-03-22';

export type Satellite = 'Sentinel-2' | 'Landsat';

export interface ImageryDate {
    date: string;
    // the smallest cloud cover of the scenes of the day, percent; null — the service did not give it
    cloudCover: number | null;
    satellites: Satellite[];
}

export interface Point {
    lat: number;
    lng: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

// only a real date: Date.UTC would move 2026-02-30 to March
export function isDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        return false;
    }
    const time = Date.parse(`${value}T00:00:00Z`);
    return !Number.isNaN(time) && isoDay(new Date(time)) === value;
}

// before the first HLS images there is a gray map without explanation, so such a date is dropped
export function parseDateParam(values: readonly string[] | undefined): string | null {
    return values?.length === 1 && isDate(values[0]) && values[0] >= FIRST_DATE ? values[0] : null;
}

// how many full days passed from the image date to today (UTC)
export function ageDays(date: string, today: Date): number {
    return Math.round((Date.parse(`${isoDay(today)}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
}

// A layer with dated for a date: DATE_TOKEN in the templates, YEAR_TOKEN in the attribution (the Copernicus year is the
// image year)
export function withDate(layer: LayerDef, date: string): LayerDef {
    const { source } = layer;
    return {
        ...layer,
        source: {
            ...source,
            tiles: source.tiles?.map((tile) => tile.replaceAll(DATE_TOKEN, date)),
            attribution: source.attribution?.replaceAll(YEAR_TOKEN, date.slice(0, 4)),
        } as LayerSource,
    };
}

// Scenes of both collections whose footprints contain the point, for DATES_DAYS days. A point, not the screen bbox: the
// cloud cover is a property of the scene, and the bbox of a small zoom touches about ten MGRS squares with different
// dates
export function datesUrl(center: Point, today: Date): string {
    const from = isoDay(new Date(today.getTime() - DATES_DAYS * DAY_MS));
    const params = new URLSearchParams({
        collections: 'sentinel-2-l2a,landsat-c2-l2',
        intersects: JSON.stringify({ type: 'Point', coordinates: [center.lng, center.lat] }),
        datetime: `${from}T00:00:00Z/..`,
        limit: String(SEARCH_LIMIT),
        sortby: '-properties.datetime',
        fields: 'properties.datetime,properties.eo:cloud_cover,properties.platform,-assets,-links,-geometry,-bbox',
    });
    return `${EARTH_SEARCH_URL}?${params}`;
}

interface SceneProperties {
    datetime?: unknown;
    platform?: unknown;
    'eo:cloud_cover'?: unknown;
}

// L30 is built only from Landsat 8 and 9, and landsat-c2-l2 has the full Landsat archive
function satelliteOf(platform: unknown): Satellite | null {
    if (typeof platform !== 'string') {
        return null;
    }
    if (/^sentinel-2[a-z]$/u.test(platform)) {
        return 'Sentinel-2';
    }
    return platform === 'landsat-8' || platform === 'landsat-9' ? 'Landsat' : null;
}

// The /search answer → dates from the newest to the oldest: the scenes of one UTC day (S2A and S2B on one day,
// Sentinel-2 and Landsat) give one date with the smallest cloud cover
export function parseDates(body: unknown): ImageryDate[] {
    const features = (body as { features?: { properties?: SceneProperties }[] } | null)?.features;
    if (!Array.isArray(features)) {
        throw new Error('Earth Search: no features');
    }
    const byDate = new Map<string, ImageryDate>();
    for (const { properties = {} } of features) {
        const satellite = satelliteOf(properties.platform);
        const date = typeof properties.datetime === 'string' ? properties.datetime.slice(0, 10) : '';
        if (!satellite || !isDate(date)) {
            continue;
        }
        const cloud = properties['eo:cloud_cover'];
        const cloudCover = typeof cloud === 'number' ? cloud : null;
        const day = byDate.get(date) ?? { date, cloudCover: null, satellites: [] };
        if (cloudCover !== null && (day.cloudCover === null || cloudCover < day.cloudCover)) {
            day.cloudCover = cloudCover;
        }
        if (!day.satellites.includes(satellite)) {
            day.satellites.push(satellite);
            day.satellites.sort();
        }
        byDate.set(date, day);
    }
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

// The newest clear date that is at least HLS_LATENCY_DAYS old, otherwise the least cloudy of these dates, otherwise
// the newest date (all dates are younger). dates go from the newest to the oldest
export function defaultDate(dates: readonly ImageryDate[], today: Date): string | null {
    const ready = dates.filter((item) => ageDays(item.date, today) >= HLS_LATENCY_DAYS);
    const clear = ready.find((item) => item.cloudCover !== null && item.cloudCover <= CLEAR_CLOUD_COVER);
    if (clear) {
        return clear.date;
    }
    const cloudiness = (item: ImageryDate) => item.cloudCover ?? Number.POSITIVE_INFINITY;
    const leastCloudy = ready.reduce<ImageryDate | null>(
        (best, item) => (best && cloudiness(best) <= cloudiness(item) ? best : item),
        null,
    );
    return leastCloudy?.date ?? dates[0]?.date ?? null;
}

export async function fetchDates(
    fetchImpl: typeof fetch,
    center: Point,
    today: Date,
    signal?: AbortSignal,
): Promise<ImageryDate[]> {
    const response = await fetchImpl(datesUrl(center, today), { signal });
    if (!response.ok) {
        throw new Error(`Earth Search: HTTP ${response.status}`);
    }
    return parseDates(await response.json());
}
