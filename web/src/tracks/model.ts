// Track model of the new app (design add-web-tracks, «Модель трека»). The data shapes repeat geodata of the old
// client (src/lib/leaflet.control.track-list/lib/parsers/): file parsers, links and import by link give
// GeoData, and the track list keeps Track.

import type { SegmentRoute } from '@/routing/line';

export interface LatLng {
    lat: number;
    lng: number;
}

export interface Waypoint extends LatLng {
    name: string;
}

export interface TrackData {
    name: string;
    segments: LatLng[][];
    points: Waypoint[];
    // index in TRACK_COLORS or a custom '#rrggbb'; without it, the next palette color in a cycle
    color?: TrackColor;
    hidden?: boolean;
    // distance ticks on the line: ticks.ts draws them, the item "Show distance marks" of the track menu (TrackList.tsx)
    // switches them, a ruler track (Measure distance in TopBar.tsx) has them on; links and autosave keep the flag
    measureTicksShown?: boolean;
    // route markup by segment (routing/line.ts): routes[i] is for segments[i], null is a plain polyline. The nktk
    // link (the route field of a segment) and autosave keep it, and GPX/KML files do not (design add-web-autosave).
    routes?: readonly (SegmentRoute | null)[];
}

// Error codes of the old client; any other string is a ready text with the {name} substitution
export type GeoError = 'CORRUPT' | 'UNSUPPORTED' | 'NETWORK' | 'INVALID_URL' | (string & {});

export interface GeoData extends TrackData {
    error?: GeoError;
}

export interface Track extends TrackData {
    id: string;
    color: TrackColor;
    visible: boolean;
}

// The color in nktk links is an index in this list (TRACKLIST_TRACK_COLORS of the old client: blue, orange, cyan,
// red, pink, yellow). The hue order is the old one, the values are more saturated (design map-chrome): the pale
// colors of the old client on an opaque line with a white outline were lost on a light map. Do not change the
// indexes: links keep them.
export const TRACK_COLORS = ['#2563eb', '#f97316', '#0891b2', '#ef4444', '#d946ef', '#eab308'] as const;

// Track color: a palette index in TRACK_COLORS or a custom color as a lowercase string '#rrggbb' (design
// track-color-picker, «Цвет — номер палитры или #rrggbb»). A palette color is always an index: then a link with it is
// byte for byte the same as in the old client, and the track follows the palette if its hues change. normalizeColor
// from color.ts brings a color to this form.
export type TrackColor = number | string;

// Paint for the map and the panels; an invalid value gives the first palette color
export function trackColor(color: TrackColor | undefined): string {
    if (typeof color === 'string') {
        return color;
    }
    return TRACK_COLORS[color ?? 0] ?? TRACK_COLORS[0];
}

export function geoData(name: string, fields: Partial<GeoData> = {}): GeoData {
    return { name, segments: [], points: [], ...fields };
}

export function isEmpty(data: TrackData): boolean {
    return data.segments.length === 0 && data.points.length === 0;
}
