import { type GeoData, type GeoError, geoData, type LatLng, type Waypoint } from '../model';
import { decode, hasUtf8Bom, startsWithAscii } from './text';

// Ozi Explorer (parsers/ozi.js of the old client): plt is a track, rte is routes, wpt is points. Ozi files use a
// Windows encoding (point names are Windows-1251, as decodeCP1251 of the old client); with a BOM, they are UTF-8.

function lines(bytes: Uint8Array): string[] {
    return decode(bytes, hasUtf8Bom(bytes) ? 'utf-8' : 'windows-1251').split('\n');
}

export function parseOziPlt(bytes: Uint8Array, name: string): GeoData[] | null {
    if (!startsWithAscii(bytes, 'OziExplorer Track Point File')) {
        return null;
    }
    const text = lines(bytes);
    let error: GeoError | undefined;
    const segments: LatLng[][] = [];
    let current: LatLng[] = [];
    let total = 0;
    for (const raw of text.slice(6)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const fields = line.split(',');
        const lat = Number.parseFloat(fields[0]);
        const lng = Number.parseFloat(fields[1]);
        const startsSegment = Number.parseInt(fields[2], 10);
        if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(startsSegment)) {
            error = 'CORRUPT';
            break;
        }
        if (startsSegment) {
            current = [];
        }
        if (current.length === 0) {
            segments.push(current);
        }
        current.push({ lat, lng });
        total += 1;
    }
    // the sixth line has the number of points; 0 means not given
    const expected = Number.parseInt(text[5], 10);
    if (Number.isNaN(expected) || (expected !== 0 && expected !== total)) {
        error = 'CORRUPT';
    }
    return [geoData(name, { segments, error })];
}

export function parseOziRte(bytes: Uint8Array, name: string): GeoData[] | null {
    if (!startsWithAscii(bytes, 'OziExplorer Route File')) {
        return null;
    }
    let error: GeoError | undefined;
    const segments: LatLng[][] = [];
    let current: LatLng[] = [];
    for (const raw of lines(bytes).slice(4)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const fields = line.split(',');
        if (fields[0] === 'R') {
            if (current.length) {
                segments.push(current);
            }
            current = [];
        } else if (fields[0] === 'W') {
            const lat = Number.parseFloat(fields[5]);
            const lng = Number.parseFloat(fields[6]);
            if (Number.isNaN(lat) || Number.isNaN(lng)) {
                error = 'CORRUPT';
                break;
            }
            current.push({ lat, lng });
        } else {
            error = 'CORRUPT';
            break;
        }
    }
    if (current.length) {
        segments.push(current);
    }
    return [geoData(name, { segments, error })];
}

export function parseOziWpt(bytes: Uint8Array, name: string): GeoData[] | null {
    if (!startsWithAscii(bytes, 'OziExplorer Waypoint File')) {
        return null;
    }
    let error: GeoError | undefined;
    const points: Waypoint[] = [];
    for (const raw of lines(bytes).slice(4)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const fields = line.split(',');
        const lat = Number.parseFloat(fields[2]);
        const lng = Number.parseFloat(fields[3]);
        if (Number.isNaN(lat) || Number.isNaN(lng)) {
            error = 'CORRUPT';
            break;
        }
        points.push({ lat, lng, name: (fields[1] ?? '').trim() });
    }
    return [geoData(name, { points, error })];
}
