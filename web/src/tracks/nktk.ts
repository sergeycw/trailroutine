import { PbfReader, PbfWriter } from 'pbf';
import { type LegMark, routeFits, type SegmentRoute, settledRoute } from '@/routing/line';
import { hexToRgb, nearestPaletteIndex, normalizeColor, rgbToHex } from './color';
import { type GeoData, geoData, type LatLng, type TrackData, type Waypoint } from './model';

// nktk track string (parsers/nktk.js of the old client): base64url of the bytes "version + data". The version is the
// first packed number: 1–3 are a custom format of packed numbers, 4 is protobuf (schema parsers/nktk.proto). No
// version number (version 0) means track:// links. Only version 4 is written, as in saveNktk. The given nktl= links
// and storage objects depend on these strings (system design audit, item 2), so parsing of all versions stays forever.
// The route markup is the optional field 3 in Segment of version 4 (schema: nktk.proto next to this file, design
// add-web-autosave, «Ссылка: необязательное поле разметки»): the protobuf of the old client skips an unknown field
// and opens the geometry.

// Coordinate grid: 2^24 − 1 divisions per 360°, ≈ 2.4 m
export const ARC_UNIT = ((1 << 24) - 1) / 360;

const DEFAULT_NAME = 'Text encoded track';

function corrupt(): GeoData[] {
    return [geoData(DEFAULT_NAME, { error: 'CORRUPT' })];
}

// urlSafeBase64.decode of the old client: spaces and line breaks are removed, = at the end is optional
export function decodeBase64Url(text: string): Uint8Array | null {
    const base64 = text
        .replace(/[\n\r \t]/gu, '')
        .replace(/-/gu, '+')
        .replace(/_/gu, '/');
    let binary: string;
    try {
        binary = atob(base64);
    } catch {
        return null;
    }
    return binary.length ? Uint8Array.from(binary, (char) => char.charCodeAt(0)) : null;
}

// With `=` at the end, as urlSafeBase64.encode of the old client: the nktl link body matches the old one byte for byte
export function encodeBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_');
}

class TruncatedError extends Error {}

// PackedStreamReader: a number is 1–4 bytes, 7 bits per byte, the high bit means "one more byte follows", with an
// offset to a signed value
class PackedReader {
    position = 0;
    private readonly bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }

    private byte(offset: number) {
        const value = this.bytes[this.position + offset];
        if (value === undefined) {
            throw new TruncatedError();
        }
        return value;
    }

    readNumber(): number {
        let x = this.byte(0);
        if (x < 128) {
            this.position += 1;
            return x - 64;
        }
        let n = x & 0x7f;
        x = this.byte(1);
        if (x < 128) {
            this.position += 2;
            return (n | (x << 7)) - 8192;
        }
        n |= (x & 0x7f) << 7;
        x = this.byte(2);
        if (x < 128) {
            this.position += 3;
            return (n | (x << 14)) - 1048576;
        }
        n |= (x & 0x7f) << 14;
        x = this.byte(3);
        this.position += 4;
        return (n | (x << 21)) - 268435456;
    }

    readString(size: number): string {
        if (size < 0 || this.position + size > this.bytes.length) {
            throw new TruncatedError();
        }
        const text = new TextDecoder().decode(this.bytes.subarray(this.position, this.position + size));
        this.position += size;
        return text;
    }

    rest() {
        return this.bytes.subarray(this.position);
    }
}

// parseNktkOld: a cut string gives CORRUPT with the data read before the cut (an incomplete segment too)
function parsePacked(bytes: Uint8Array, version: number): GeoData {
    const reader = new PackedReader(bytes);
    const result = geoData('');
    let truncated = false;
    let segment: LatLng[] | null = null;
    try {
        result.name = reader.readString(reader.readNumber());
        const segmentsCount = reader.readNumber();
        for (let i = 0; i < segmentsCount; i++) {
            segment = [];
            const pointsCount = reader.readNumber();
            let x = 0;
            let y = 0;
            for (let j = 0; j < pointsCount; j++) {
                x += reader.readNumber();
                y += reader.readNumber();
                segment.push({ lat: y / ARC_UNIT, lng: x / ARC_UNIT });
            }
            result.segments.push(segment);
            segment = null;
        }
    } catch (error) {
        if (!(error instanceof TruncatedError)) {
            throw error;
        }
        truncated = true;
        if (segment) {
            result.segments.push(segment);
        }
    }

    if (!truncated) {
        try {
            result.color = reader.readNumber();
            result.measureTicksShown = Boolean(reader.readNumber());
        } catch {
            // version 0 (track://) could end on the segments
            result.color = 0;
            result.measureTicksShown = false;
            truncated = version > 0;
        }
    }
    if (version >= 3 && !truncated) {
        try {
            result.hidden = Boolean(reader.readNumber());
        } catch {
            truncated = true;
        }
    }
    if (version >= 2 && !truncated) {
        try {
            const pointsCount = reader.readNumber();
            const midX = pointsCount ? reader.readNumber() : 0;
            const midY = pointsCount ? reader.readNumber() : 0;
            for (let i = 0; i < pointsCount; i++) {
                const name = reader.readString(reader.readNumber());
                reader.readNumber(); // point symbol, not used
                const x = reader.readNumber() + midX;
                const y = reader.readNumber() + midY;
                result.points.push({ name, lat: y / ARC_UNIT, lng: x / ARC_UNIT });
            }
        } catch {
            truncated = true;
        }
    }
    // in the old client, the color and the ticks that were not read are zeros
    result.name ||= DEFAULT_NAME;
    result.color ??= 0;
    result.measureTicksShown ??= false;
    result.hidden ??= false;
    if (truncated) {
        result.error = 'CORRUPT';
    }
    return result;
}

// Version 4 protobuf: manual parsing of the nktk.proto schema (the generated nktk_pb.js of the old client, pbf 3)
interface ViewMessage {
    color: number;
    shown: boolean;
    ticksShown: boolean;
    // custom color 0xRRGGBB; null means no field (black is 0, so null and not zero)
    rgb: number | null;
}
interface SegmentMessage {
    lats: number[];
    lons: number[];
    route: RouteMessage | null;
}
// SegmentRoute from nktk.proto: steps between waypoint indexes, leg codes and the activity table of the segment
interface RouteMessage {
    gaps: number[];
    legs: number[];
    activities: string[];
}
interface WaypointMessage {
    lat: number;
    lon: number;
    name: string;
}
interface WaypointsMessage {
    midLat: number;
    midLon: number;
    waypoints: WaypointMessage[];
}
interface TrackMessage {
    name: string;
    segments: SegmentMessage[];
    waypoints: WaypointsMessage | null;
}

function readMessage<T>(pbf: PbfReader, init: T, read: (tag: number, obj: T, pbf: PbfReader) => void): T {
    return pbf.readFields(read, init, pbf.readVarint() + pbf.pos);
}

function readRoute(tag: number, obj: RouteMessage, pbf: PbfReader) {
    if (tag === 1) pbf.readPackedVarint(obj.gaps);
    else if (tag === 2) pbf.readPackedVarint(obj.legs);
    else if (tag === 3 && pbf.type === 2) obj.activities.push(pbf.readString());
}

function readSegment(tag: number, obj: SegmentMessage, pbf: PbfReader) {
    if (tag === 1) pbf.readPackedSVarint(obj.lats);
    else if (tag === 2) pbf.readPackedSVarint(obj.lons);
    else if (tag === 3 && pbf.type === 2) obj.route = readRouteField(pbf);
}

// The markup field is parsed separately: if it is broken inside (a wrong type, a cut number), the segment has no
// markup, and the whole track is not CORRUPT. The old client skips such a field by its length and opens the geometry.
function readRouteField(pbf: PbfReader): RouteMessage | null {
    const end = pbf.readVarint() + pbf.pos;
    if (end > pbf.length) {
        throw new Error('route field is out of bounds');
    }
    let route: RouteMessage | null;
    try {
        route = pbf.readFields(readRoute, { gaps: [], legs: [], activities: [] }, end);
    } catch {
        route = null;
    }
    pbf.pos = end;
    return route;
}

function readWaypoint(tag: number, obj: WaypointMessage, pbf: PbfReader) {
    if (tag === 1) obj.lat = pbf.readSVarint();
    else if (tag === 2) obj.lon = pbf.readSVarint();
    else if (tag === 3) obj.name = pbf.readString();
}

function readWaypoints(tag: number, obj: WaypointsMessage, pbf: PbfReader) {
    if (tag === 1) obj.midLat = pbf.readSVarint();
    else if (tag === 2) obj.midLon = pbf.readSVarint();
    else if (tag === 3) obj.waypoints.push(readMessage(pbf, { lat: 0, lon: 0, name: '' }, readWaypoint));
}

function readTrack(tag: number, obj: TrackMessage, pbf: PbfReader) {
    if (tag === 1) obj.name = pbf.readString();
    else if (tag === 2) obj.segments.push(readMessage(pbf, { lats: [], lons: [], route: null }, readSegment));
    else if (tag === 3) obj.waypoints = readMessage(pbf, { midLat: 0, midLon: 0, waypoints: [] }, readWaypoints);
}

function readView(tag: number, obj: ViewMessage, pbf: PbfReader) {
    if (tag === 1) obj.color = pbf.readVarint(true);
    else if (tag === 2) obj.shown = pbf.readBoolean();
    else if (tag === 3) obj.ticksShown = pbf.readBoolean();
    // a foreign type or a value outside 0xRRGGBB is the same as no field: the palette color from color
    else if (tag === 4 && pbf.type === 0) {
        const rgb = pbf.readVarint();
        obj.rgb = rgb <= 0xffffff ? rgb : null;
    }
}

function deltaDecode(lats: number[], lons: number[]): LatLng[] {
    const points: LatLng[] = [];
    let lat = 0;
    let lng = 0;
    for (let i = 0; i < lats.length; i++) {
        lat += lats[i];
        lng += lons[i];
        points.push({ lat: lat / ARC_UNIT, lng: lng / ARC_UNIT });
    }
    return points;
}

// Leg code: 0 is straight, 2k+1 is routed with the activity activities[k], 2k+2 is not routed with activities[k]
function decodeLeg(code: number, activities: readonly string[]): LegMark | null {
    if (code === 0) {
        return { state: 'straight' };
    }
    const activity = activities[(code - 1) >> 1];
    if (activity === undefined) {
        return null;
    }
    return { state: code % 2 === 1 ? 'routed' : 'failed', activity };
}

// Invalid markup (no match with the segment points, a code outside the table) is null: the segment opens as a polyline
function decodeRoute(message: RouteMessage | null, points: readonly LatLng[]): SegmentRoute | null {
    if (!message || message.gaps.length !== message.legs.length) {
        return null;
    }
    const legs: LegMark[] = [];
    for (const code of message.legs) {
        const leg = decodeLeg(code, message.activities);
        if (!leg) {
            return null;
        }
        legs.push(leg);
    }
    const waypoints = [0];
    for (const gap of message.gaps) {
        waypoints.push(waypoints[waypoints.length - 1] + gap);
    }
    const route = { waypoints, legs };
    return routeFits(points, route) ? route : null;
}

function encodeRoute(route: SegmentRoute): RouteMessage {
    const activities: string[] = [];
    const legs = route.legs.map((leg) => {
        if (leg.state === 'straight') {
            return 0;
        }
        let index = activities.indexOf(leg.activity);
        if (index < 0) {
            index = activities.push(leg.activity) - 1;
        }
        return 2 * index + (leg.state === 'routed' ? 1 : 2);
    });
    const gaps = route.waypoints.slice(1).map((index, i) => index - route.waypoints[i]);
    return { gaps, legs, activities };
}

function parseProtobuf(bytes: Uint8Array): GeoData[] {
    let view: ViewMessage | null = null;
    let track: TrackMessage | null = null;
    try {
        new PbfReader(bytes).readFields((tag, _, pbf) => {
            if (tag === 1) view = readMessage(pbf, { color: 0, shown: false, ticksShown: false, rgb: null }, readView);
            else if (tag === 2) track = readMessage(pbf, { name: '', segments: [], waypoints: null }, readTrack);
        }, null);
    } catch {
        return corrupt();
    }
    // in the old client, parsing without track or view failed with an exception
    const v = view as ViewMessage | null;
    const t = track as TrackMessage | null;
    if (!v || !t) {
        return corrupt();
    }
    const result = geoData(t.name || DEFAULT_NAME, {
        color: v.rgb === null ? v.color : normalizeColor(rgbToHex(v.rgb)),
        hidden: !v.shown,
        measureTicksShown: v.ticksShown,
        segments: t.segments.map((segment) => deltaDecode(segment.lats, segment.lons)),
    });
    const routes = t.segments.map((segment, i) => decodeRoute(segment.route, result.segments[i]));
    if (routes.some(Boolean)) {
        result.routes = routes;
    }
    const waypoints = t.waypoints;
    if (waypoints) {
        result.points = waypoints.waypoints.map((point) => ({
            name: point.name,
            lat: (point.lat + waypoints.midLat) / ARC_UNIT,
            lng: (point.lon + waypoints.midLon) / ARC_UNIT,
        }));
    }
    return [result];
}

// One nktk string with a version (the nktk= parameter, an item of the nktl body)
export function parseNktk(text: string): GeoData[] {
    const bytes = decodeBase64Url(text);
    if (!bytes) {
        return corrupt();
    }
    const reader = new PackedReader(bytes);
    let version: number;
    try {
        version = reader.readNumber();
    } catch {
        return corrupt();
    }
    if (version >= 1 && version <= 3) {
        return [parsePacked(reader.rest(), version)];
    }
    if (version === 4) {
        return parseProtobuf(reader.rest());
    }
    return corrupt();
}

// Strings joined with `/`: the nktl storage body and several tracks in nktk=
export function parseNktkSequence(text: string): GeoData[] {
    return text.split('/').flatMap(parseNktk);
}

// track://…: version 0 without the version number
export function parseTrackUrlData(text: string): GeoData[] {
    const bytes = decodeBase64Url(text);
    return bytes ? [parsePacked(bytes, 0)] : corrupt();
}

function deltaEncode(points: readonly LatLng[]) {
    const lats: number[] = [];
    const lons: number[] = [];
    let lastLat = 0;
    let lastLon = 0;
    for (const point of points) {
        const lat = Math.round(point.lat * ARC_UNIT);
        const lon = Math.round(point.lng * ARC_UNIT);
        lats.push(lat - lastLat);
        lons.push(lon - lastLon);
        lastLat = lat;
        lastLon = lon;
    }
    return { lats, lons };
}

function writeWaypoints(points: readonly Waypoint[], pbf: PbfWriter) {
    let midLat = 0;
    let midLon = 0;
    for (const point of points) {
        midLat += point.lat;
        midLon += point.lng;
    }
    midLat = Math.round((midLat * ARC_UNIT) / points.length);
    midLon = Math.round((midLon * ARC_UNIT) / points.length);
    if (midLat) pbf.writeSVarintField(1, midLat);
    if (midLon) pbf.writeSVarintField(2, midLon);
    for (const point of points) {
        pbf.writeMessage(
            3,
            (p: Waypoint, out: PbfWriter) => {
                const lat = Math.round(p.lat * ARC_UNIT) - midLat;
                const lon = Math.round(p.lng * ARC_UNIT) - midLon;
                if (lat) out.writeSVarintField(1, lat);
                if (lon) out.writeSVarintField(2, lon);
                if (p.name) out.writeStringField(3, p.name);
            },
            point,
        );
    }
}

function writeRoute({ gaps, legs, activities }: RouteMessage, pbf: PbfWriter) {
    pbf.writePackedVarint(1, gaps);
    pbf.writePackedVarint(2, legs);
    for (const activity of activities) {
        pbf.writeStringField(3, activity);
    }
}

// Markup that can be written: a pending leg is written as not routed (no response comes to a link), invalid markup is
// not written
function writableRoute(points: readonly LatLng[], route: SegmentRoute | null | undefined): RouteMessage | null {
    const settled = settledRoute(route);
    return settled && routeFits(points, settled) ? encodeRoute(settled) : null;
}

// saveNktk of the old client: version 4; empty fields are not written, as in the generated pbf code. A track without
// markup gives the string of the old client byte for byte: the route field is written only if the segment has markup.
export function saveNktk(track: TrackData): string {
    const pbf = new PbfWriter();
    pbf.writeMessage(
        1,
        (_: null, out: PbfWriter) => {
            // custom color: color has the nearest palette color for readers without the rgb field (the author's
            // client), rgb has the exact color
            const color = typeof track.color === 'string' ? nearestPaletteIndex(track.color) : track.color;
            if (color) out.writeVarintField(1, color);
            if (!track.hidden) out.writeBooleanField(2, true);
            if (track.measureTicksShown) out.writeBooleanField(3, true);
            if (typeof track.color === 'string') out.writeVarintField(4, hexToRgb(track.color));
        },
        null,
    );
    pbf.writeMessage(
        2,
        (_: null, out: PbfWriter) => {
            if (track.name) out.writeStringField(1, track.name);
            track.segments.forEach((segment, i) => {
                out.writeMessage(
                    2,
                    ({ lats, lons, route }: SegmentMessage, segmentOut: PbfWriter) => {
                        segmentOut.writePackedSVarint(1, lats);
                        segmentOut.writePackedSVarint(2, lons);
                        if (route) {
                            segmentOut.writeMessage(3, writeRoute, route);
                        }
                    },
                    { ...deltaEncode(segment), route: writableRoute(segment, track.routes?.[i]) },
                );
            });
            if (track.points.length) {
                out.writeMessage(3, writeWaypoints, track.points);
            }
        },
        null,
    );
    const body = pbf.finish();
    const bytes = new Uint8Array(body.length + 1);
    bytes[0] = 4 + 64;
    bytes.set(body, 1);
    return encodeBase64Url(bytes);
}
