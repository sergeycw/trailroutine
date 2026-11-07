import { type GeoData, type GeoError, geoData, type LatLng, type Waypoint } from '../model';
import { decodeXml } from './text';
import { elements, nodeText, parseXml } from './xml';

// GPX (parsers/gpx.js of the old client): trkseg segments, then rte routes as separate segments, wpt points.
// A point without coordinates gives CORRUPT: a segment ends at it, and a wpt point is skipped.

function linePoints(parent: Element, tag: string, fail: () => void): LatLng[] {
    const points: LatLng[] = [];
    for (const element of elements(parent, tag)) {
        const lat = Number.parseFloat(element.getAttribute('lat') ?? '');
        const lng = Number.parseFloat(element.getAttribute('lon') ?? '');
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            fail();
            break;
        }
        points.push({ lat, lng });
    }
    return points;
}

// preferNameFromFile: the name of the first trk with a non-empty name instead of the file name (OSM track import)
export function parseGpxText(text: string, name: string, preferNameFromFile = false): GeoData[] | null {
    const dom = parseXml(text);
    if (!dom || elements(dom, 'gpx').length === 0) {
        return null;
    }
    let error: GeoError | undefined;
    const fail = () => {
        error = 'CORRUPT';
    };

    const segments: LatLng[][] = [];
    for (const [parentTag, pointTag] of [
        ['trkseg', 'trkpt'],
        ['rte', 'rtept'],
    ]) {
        for (const parent of elements(dom, parentTag)) {
            const points = linePoints(parent, pointTag, fail);
            if (points.length) {
                segments.push(points);
            }
        }
    }

    const points: Waypoint[] = [];
    for (const element of elements(dom, 'wpt')) {
        const lat = Number.parseFloat(element.getAttribute('lat') ?? '');
        const lng = Number.parseFloat(element.getAttribute('lon') ?? '');
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            fail();
            continue;
        }
        points.push({ lat, lng, name: nodeText(elements(element, 'name')[0]) ?? '' });
    }

    let trackName = name;
    if (preferNameFromFile) {
        for (const trk of elements(dom, 'trk')) {
            const trkName = nodeText(elements(trk, 'name')[0]);
            if (trkName) {
                trackName = trkName;
                break;
            }
        }
    }
    return [geoData(trackName, { segments, points, error })];
}

export function parseGpx(bytes: Uint8Array, name: string): GeoData[] | null {
    return parseGpxText(decodeXml(bytes), name);
}
