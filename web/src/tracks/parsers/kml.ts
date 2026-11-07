import { type GeoData, type GeoError, geoData, type LatLng, type Waypoint } from '../model';
import { decodeXml } from './text';
import { elements, nodeText, parseXml } from './xml';
import { unzip } from './zip-entries';

// KML and KMZ (parsers/kml.js of the old client): LineString and gx:Track are segments,
// a Placemark with a Point is a point.

interface KmlContent {
    segments: LatLng[][];
    points: Waypoint[];
    error?: GeoError;
}

function parseKmlContent(text: string): KmlContent | null {
    const dom = parseXml(text);
    if (!dom || elements(dom, 'kml').length === 0) {
        return null;
    }
    let error: GeoError | undefined;
    const segments: LatLng[][] = [];

    for (const lineString of elements(dom, 'LineString')) {
        const coordinates = elements(lineString, 'coordinates')[0];
        if (!coordinates) {
            continue;
        }
        const line: LatLng[] = [];
        for (const tuple of (nodeText(coordinates) ?? '').split(/\s+/u)) {
            if (!tuple) {
                continue;
            }
            const [lng, lat] = tuple.split(',').map(Number.parseFloat);
            if (Number.isNaN(lat) || Number.isNaN(lng) || lat === undefined) {
                error = 'CORRUPT';
                break;
            }
            line.push({ lat, lng });
        }
        if (line.length) {
            segments.push(line);
        }
    }

    // gx:Track comes after LineString, as in the old client; parseXml removed the prefix
    for (const track of elements(dom, 'gx_Track')) {
        const line: LatLng[] = [];
        for (const coord of elements(track, 'gx_coord')) {
            const [lng, lat] = (nodeText(coord) ?? '').trim().split(/\s+/u).map(Number);
            if (Number.isNaN(lat) || Number.isNaN(lng) || lat === undefined) {
                error = 'CORRUPT';
                break;
            }
            line.push({ lat, lng });
        }
        if (line.length) {
            segments.push(line);
        }
    }

    const points: Waypoint[] = [];
    for (const placemark of elements(dom, 'Placemark')) {
        const pointElements = elements(placemark, 'Point');
        if (pointElements.length === 0) {
            continue;
        }
        const coordinates = pointElements.length === 1 ? elements(pointElements[0], 'coordinates') : [];
        const [lng, lat] =
            coordinates.length === 1 ? (nodeText(coordinates[0]) ?? '').split(',').map(Number.parseFloat) : [];
        if (lat === undefined || Number.isNaN(lat) || Number.isNaN(lng)) {
            error = 'CORRUPT';
            break;
        }
        points.push({ lat, lng, name: nodeText(elements(placemark, 'name')[0]) ?? '' });
    }
    return { segments, points, error };
}

export function parseKml(bytes: Uint8Array, name: string): GeoData[] | null {
    const content = parseKmlContent(decodeXml(bytes));
    return content && [geoData(name, content)];
}

// KMZ is a ZIP with doc.kml: all .kml files of the archive make one track with the file name. In the old client,
// parseKmz always returned null (the default import of the vendored js-unzip through webpack is a module object, not a
// constructor), and KMZ opened through the ZIP branch as one track for each .kml (fixtures/README.md); here it is one
// track, as the old code intended.
export function parseKmz(bytes: Uint8Array, name: string): GeoData[] | null {
    const entries = unzip(bytes);
    if (!entries?.some((entry) => entry.name === 'doc.kml')) {
        return null;
    }
    const result = geoData(name);
    for (const entry of entries) {
        if (!/\.kml$/iu.test(entry.name)) {
            continue;
        }
        const content = parseKmlContent(decodeXml(entry.data));
        if (content) {
            result.error ??= content.error;
            result.segments.push(...content.segments);
            result.points.push(...content.points);
        }
    }
    return [result];
}
