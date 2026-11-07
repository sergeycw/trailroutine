import { PLACE_ZOOM, type SearchResponse } from './result';

// Parsing of coordinates in the search bar: a port of CoordinatesProvider of the old client
// (src/lib/leaflet.control.search/providers/coordinates.js) without behavior changes: input normalization, the
// formats D, DM, DMS with hemispheres and D with a sign, two order variants if there are no hemispheres. The cases are
// the karma test test/test_search_coordinates.js, moved to coordinates.test.ts.

const reInteger = '\\d+';
const reFractional = '\\d+(?:\\.\\d+)?';
const reSignedFractional = '-?\\d+(?:\\.\\d+)?';
const reHemisphere = '[NWSE]';

interface Parsed {
    title: string;
    lat: number;
    lng: number;
}

interface Hemispheres {
    swapLatLon: boolean;
    latIsSouth: boolean;
    lonIsWest: boolean;
}

function parseHemispheres(
    h1: string | undefined,
    h2: string | undefined,
    h3: string | undefined,
    allowEmpty = false,
): Hemispheres | 'empty' | null {
    const isLat = (h: string) => h === 'N' || h === 'S';
    let hLat: string;
    let hLon: string;
    if (h1 && h2 && !h3) {
        hLat = h1.trim();
        hLon = h2.trim();
    } else if (h1 && !h2 && h3) {
        hLat = h1.trim();
        hLon = h3.trim();
    } else if (!h1 && h2 && h3) {
        hLat = h2.trim();
        hLon = h3.trim();
    } else if (allowEmpty && !h1 && !h2 && !h3) {
        return 'empty';
    } else {
        return null;
    }
    if (isLat(hLat) === isLat(hLon)) {
        return null;
    }
    let swapLatLon = false;
    if (isLat(hLon)) {
        [hLat, hLon] = [hLon, hLat];
        swapLatLon = true;
    }
    return { swapLatLon, latIsSouth: hLat === 'S', lonIsWest: hLon === 'W' };
}

const letters = (latIsSouth: boolean, lonIsWest: boolean) => [latIsSouth ? 'S' : 'N', lonIsWest ? 'W' : 'E'];

// Latitude or longitude as degrees, minutes and seconds (minutes and seconds can be missing)
type Parts = [deg: number, min?: number, sec?: number];

// The isValid checks of the old client: DMS minutes are integers up to 59, DM minutes are fractional and less than 60,
// seconds are less than 60; at 90° and 180°, without minutes and seconds
function validParts([deg, min, sec]: Parts, maxDeg: number): boolean {
    if (deg < 0 || deg > maxDeg) {
        return false;
    }
    if (min === undefined) {
        return true;
    }
    if (min < 0 || (sec === undefined ? min >= 60 : min > 59)) {
        return false;
    }
    if (sec !== undefined && (sec < 0 || sec >= 60)) {
        return false;
    }
    return deg <= maxDeg - 1 || (min === 0 && (sec ?? 0) === 0);
}

function partsValue([deg, min = 0, sec = 0]: Parts): number {
    return deg + min / 60 + sec / 3600;
}

function formatParts([deg, min, sec]: Parts): string {
    if (min === undefined) {
        return `${deg}°`;
    }
    if (sec === undefined) {
        return `${deg}°${min}′`;
    }
    return `${deg}°${min}′${sec}″`;
}

function sameParts(a: Parts, b: Parts): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i]);
}

// The format with hemispheres: DMS (3 numbers per coordinate), DM (2), D (1). D requires hemispheres.
function parseWithHemispheres(s: string, size: 1 | 2 | 3): Parsed[] | null {
    const numbers = [reInteger, reInteger, reFractional].slice(3 - size);
    const coordinate = numbers.map((re) => `(${re})`).join(' ');
    const regexp = new RegExp(
        `^(${reHemisphere} )?${coordinate} (${reHemisphere} )?${coordinate}( ${reHemisphere})?$`,
        'u',
    );
    const m = s.match(regexp);
    if (!m) {
        return null;
    }
    const groups = m.slice(1);
    const h1 = groups[0];
    const first = groups.slice(1, 1 + size).map(Number.parseFloat) as Parts;
    const h2 = groups[1 + size];
    const second = groups.slice(2 + size, 2 + 2 * size).map(Number.parseFloat) as Parts;
    const h3 = groups[2 + 2 * size];
    const hemispheres = parseHemispheres(h1, h2, h3, size > 1);
    if (!hemispheres) {
        return null;
    }
    const make = (lat: Parts, lng: Parts, latIsSouth: boolean, lonIsWest: boolean): Parsed | null => {
        if (!validParts(lat, 90) || !validParts(lng, 180)) {
            return null;
        }
        const [latLetter, lngLetter] = letters(latIsSouth, lonIsWest);
        return {
            title: `${latLetter} ${formatParts(lat)} ${lngLetter} ${formatParts(lng)}`,
            lat: latIsSouth ? -partsValue(lat) : partsValue(lat),
            lng: lonIsWest ? -partsValue(lng) : partsValue(lng),
        };
    };
    const results: Parsed[] = [];
    if (hemispheres === 'empty') {
        const direct = make(first, second, false, false);
        if (direct) {
            results.push(direct);
        }
        if (!sameParts(first, second)) {
            const swapped = make(second, first, false, false);
            if (swapped) {
                results.push(swapped);
            }
        }
    } else {
        const [lat, lng] = hemispheres.swapLatLon ? [second, first] : [first, second];
        const parsed = make(lat, lng, hemispheres.latIsSouth, hemispheres.lonIsWest);
        if (parsed) {
            results.push(parsed);
        }
    }
    return results.length ? results : null;
}

function parseSigned(s: string): Parsed[] | null {
    const m = s.match(new RegExp(`^(${reSignedFractional}) (${reSignedFractional})$`, 'u'));
    if (!m) {
        return null;
    }
    // Number.parseFloat('-0') is -0; the label of the old client is `${-0}°` = `0°`
    const [d1, d2] = m.slice(1).map(Number.parseFloat);
    const valid = (lat: number, lng: number) => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    const results: Parsed[] = [];
    if (valid(d1, d2)) {
        results.push({ title: `${d1}° ${d2}°`, lat: d1, lng: d2 });
    }
    if (d1 !== d2 && valid(d2, d1)) {
        results.push({ title: `${d2}° ${d1}°`, lat: d2, lng: d1 });
    }
    return results.length ? results : null;
}

// The regular expressions of normalizeInput of the old client. symbols are all Unicode characters except letters and
// [0-9,.-] (the script of the author gist.github.com/wladich/3d15edc8fcd8b735ac883ef60fe10bfe), plus by hand «oO» in
// Latin script and «оО» in Cyrillic script (the degree sign)
const SYMBOLS =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: whole Unicode ranges, control characters included
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: ranges, not a letter with a combining mark
    /[OoОо\u0000-\u002b\u002f\u003a-\u0040\u005b-\u0060\u007b-\u00bf\u00d7\u00f7\u01bb\u01c0-\u01cc\u0294\u02b9-\u036f\u0375\u03f6\u0482-\u0489\u0559-\u055f\u0589-\u109f\u10fb\u10fc\u1100-\u139f\u1400-\u1c7f\u1cc0-\u1cff\u1d2f-\u1d6a\u1dc0-\u1dff\u1f88-\u1f8f\u1f98-\u1f9f\u1fa8-\u1faf\u1fbc-\u1fc1\u1fcc-\u1fcf\u1ffc-\u2131\u213a-\u214d\u214f-\u2182\u2185-\u2bff\u2ce5-\u2cea\u2cef-\u2cf1\u2cf9-\u2cff\u2d30-\ua63f\ua66e-\ua67f\ua69e-\ua721\ua788-\ua78a\ua78f\ua7f7-\ua7f9\ua7fb-\uab2f\uab5b-\uab5f\uabc0-\uffff]/gu;
const NORTH = /[Nn]|[СсCc] *[Шш]?/gu;
const SOUTH = /[Ss]|[Юю] *[Шш]?/gu;
const WEST = /[Ww]|[Зз] *[Дд]?/gu;
// the second «Ее» is Cyrillic
const EAST = /[EeЕе]|[ВвB] *[Дд]?/gu;

export function normalizeCoordinates(input: string): string {
    // NFKC converts superscripts and subscripts to usual characters
    let s = ` ${input.normalize('NFKC')} `;
    s = s.replace(SYMBOLS, ' ');
    // dots and commas that are not between digits are separators
    s = s.replace(/[,.](?=\D)/gu, ' ');
    s = s.replace(/(\D)[,.]/gu, '$1 ');
    // if there is a dot, it is the decimal separator, and commas are separators; otherwise a comma is the decimal
    // separator
    s = s.includes('.') ? s.replace(/,/gu, ' ') : s.replace(/,/gu, '.');
    // a minus only at the start of a number
    s = s.replace(/-(?=\D)/gu, ' ');
    s = s.replace(/([^ ])-/gu, '$1 ');
    s = s.replace(NORTH, ' N ');
    s = s.replace(SOUTH, ' S ');
    s = s.replace(WEST, ' W ');
    s = s.replace(EAST, ' E ');
    return s.replace(/ +/gu, ' ').trim();
}

// The string looks like coordinates: at least two fields, all are numbers or hemispheres, at least one number
export function isCoordinatesQuery(query: string): boolean {
    const fields = normalizeCoordinates(query).split(' ');
    const field = new RegExp(`^((${reHemisphere})|(${reSignedFractional}))$`, 'u');
    const number = new RegExp(`^(${reSignedFractional})$`, 'u');
    return fields.length > 1 && fields.every((f) => field.test(f)) && fields.some((f) => number.test(f));
}

export function searchCoordinates(query: string): SearchResponse {
    const s = normalizeCoordinates(query);
    const parsed =
        parseWithHemispheres(s, 3) ?? parseWithHemispheres(s, 2) ?? parseWithHemispheres(s, 1) ?? parseSigned(s);
    if (!parsed) {
        return { error: 'Invalid coordinates' };
    }
    return {
        results: parsed.map(({ title, lat, lng }) => ({
            title,
            subtitle: 'Coordinates',
            latlng: { lat, lng },
            bounds: null,
            zoom: PLACE_ZOOM,
        })),
    };
}
