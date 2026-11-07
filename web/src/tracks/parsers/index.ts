import { type GeoData, geoData } from '../model';
import { parseGeojson } from './geojson';
import { parseGpx } from './gpx';
import { parseKml, parseKmz } from './kml';
import { parseOziPlt, parseOziRte, parseOziWpt } from './ozi';
import { unzip } from './zip-entries';

// The file format comes from the content, not from the extension: the parsers try in turn, as parsers/index.js of the
// old client; each parser gives null if the file is not in its format.

type Parser = (bytes: Uint8Array, name: string) => GeoData[] | null;

// Inside a ZIP, documents, images and directories are skipped silently: people put them next to the tracks
const ZIP_SKIPPED = /(\.(pdf|doc|txt|jpg))|\/$/iu;

function parseZip(bytes: Uint8Array): GeoData[] | null {
    const entries = unzip(bytes);
    if (!entries) {
        return null;
    }
    return entries.flatMap((entry) =>
        parseGeoFile(entry.name, entry.data).filter(
            (item) => !(item.error === 'UNSUPPORTED' && ZIP_SKIPPED.test(item.name)),
        ),
    );
}

const PARSERS: Parser[] = [parseKmz, parseZip, parseGpx, parseOziRte, parseOziPlt, parseOziWpt, parseKml, parseGeojson];

export function parseGeoFile(name: string, bytes: Uint8Array): GeoData[] {
    for (const parser of PARSERS) {
        const parsed = parser(bytes, name);
        if (parsed !== null) {
            return parsed;
        }
    }
    return [geoData(name, { error: 'UNSUPPORTED' })];
}
