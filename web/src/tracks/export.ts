import { splitLinesAt180 } from './geometry';
import type { LatLng, TrackData, Waypoint } from './model';

// Track export (geo_file_exporters.js and exportTrackAsFile of the old client): GPX 1.1 and KML 2.2; the ZIP of all
// tracks is removed (design trim-track-menus). Strings are plain JS strings: Blob converts them to UTF-8 on save (the
// old client encoded by hand through a binary string).

export interface ExportedFile {
    filename: string;
    content: string;
    mimeType: string;
}

export class EmptyTrackError extends Error {
    constructor() {
        super('Track is empty, nothing to save');
    }
}

function escapeXml(text: string): string {
    return text
        .replace(/&/gu, '&amp;')
        .replace(/</gu, '&lt;')
        .replace(/>/gu, '&gt;')
        .replace(/"/gu, '&quot;')
        .replace(/'/gu, '&#39;');
}

const coord = (value: number) => value.toFixed(6);

// Elevations for GPX with elevations: one for each track point and each segment point; null means no <ele> (the
// elevation API has no data for the point)
export interface GpxElevations {
    points: readonly (number | null)[];
    segments: readonly (readonly (number | null)[])[];
}

// <ele> with one decimal place, as saveGpx(…, withElevations) of the old client
const ele = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : `<ele>${value.toFixed(1)}</ele>`;

export function toGpx(
    name: string,
    segments: readonly (readonly LatLng[])[],
    points: readonly Waypoint[],
    elevations?: GpxElevations,
): string {
    // time on track points means nothing: Garmin Connect did not accept the file without it (old client comment)
    const fakeTime = '1970-01-01T00:00:01.000Z';
    const gpx = [
        '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
        '<gpx xmlns="http://www.topografix.com/GPX/1/1" creator="trailroutine" ' +
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 ' +
            'http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1">',
        '\t<metadata>',
        `\t\t<time>${new Date().toISOString()}</time>`,
        '\t</metadata>',
    ];
    points.forEach((point, i) => {
        gpx.push(`\t<wpt lat="${coord(point.lat)}" lon="${coord(point.lng)}">`);
        // the order of wpt elements by the GPX 1.1 schema: ele before name
        const height = ele(elevations?.points[i]);
        if (height) {
            gpx.push(`\t\t${height}`);
        }
        gpx.push(`\t\t<name>${escapeXml(point.name)}</name>`);
        gpx.push('\t</wpt>');
    });
    if (segments.length) {
        gpx.push('\t<trk>');
        gpx.push(`\t\t<name>${escapeXml(name || 'Track')}</name>`);
        segments.forEach((segment, k) => {
            gpx.push('\t\t<trkseg>');
            segment.forEach((point, i) => {
                const height = ele(elevations?.segments[k]?.[i]);
                gpx.push(
                    `\t\t\t<trkpt lat="${coord(point.lat)}" lon="${coord(point.lng)}">${height}<time>${fakeTime}</time></trkpt>`,
                );
            });
            gpx.push('\t\t</trkseg>');
        });
        gpx.push('\t</trk>');
    }
    gpx.push('</gpx>');
    return gpx.join('\n');
}

export function toKml(name: string, segments: readonly (readonly LatLng[])[], points: readonly Waypoint[]): string {
    const kml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2">',
        '\t<Document>',
        `\t\t<name>${escapeXml(name || 'Track')}</name>`,
    ];
    segments.forEach((segment, i) => {
        kml.push('\t\t<Placemark>', `\t\t\t<name>Line ${i + 1}</name>`, '\t\t\t<LineString>');
        kml.push('\t\t\t\t<tessellate>1</tessellate>', '\t\t\t\t<coordinates>');
        for (const point of segment) {
            kml.push(`\t\t\t\t\t${coord(point.lng)},${coord(point.lat)}`);
        }
        kml.push('\t\t\t\t</coordinates>', '\t\t\t</LineString>', '\t\t</Placemark>');
    });
    for (const point of points) {
        kml.push('\t\t<Placemark>', `\t\t\t<name>${escapeXml(point.name)}</name>`, '\t\t\t<Point>');
        kml.push(`\t\t\t\t<coordinates>${coord(point.lng)},${coord(point.lat)},0</coordinates>`);
        kml.push('\t\t\t</Point>', '\t\t</Placemark>');
    }
    kml.push('\t</Document>', '</kml>');
    return kml.join('\n');
}

// splitExtensionsFirstStage and splitExtensions of the old client: «track.gpx» → «track», «track.gpx.xml» → «track»
const EXTENSION_STAGES = [
    ['xml', 'txt', 'html', 'php', 'tmp', 'gz'],
    ['gpx', 'kml', 'geojson', 'kmz', 'wpt', 'rte', 'plt', 'fit', 'tmp', 'jpg', 'crdownload'],
];

export function fileBaseName(trackName: string): string {
    // the browser (Chrome) removes a dot at the start of the name, and on Linux it is a hidden file
    let name = trackName.replace(/^\./u, '_');
    for (const extensions of EXTENSION_STAGES) {
        const dot = name.lastIndexOf('.');
        if (dot > -1 && extensions.includes(name.slice(dot + 1).toLowerCase())) {
            name = name.slice(0, dot);
        }
    }
    return name;
}

type Format = 'gpx' | 'kml';

const FORMATS: Record<Format, { write: typeof toGpx; mimeType: string }> = {
    gpx: { write: toGpx, mimeType: 'application/gpx+xml' },
    kml: { write: toKml, mimeType: 'application/vnd.google-earth.kml+xml' },
};

// An empty track gives EmptyTrackError
export function exportTrack(track: TrackData, format: Format): ExportedFile {
    const segments = splitLinesAt180(track.segments);
    if (segments.length === 0 && track.points.length === 0) {
        throw new EmptyTrackError();
    }
    const name = fileBaseName(track.name);
    const { write, mimeType } = FORMATS[format];
    return { filename: `${name}.${format}`, content: write(name, segments, track.points), mimeType };
}

// GPX with elevations (exportTrackAsFile of the old client with addElevations): elevations of all track points and
// segment points, without sampling, after the split at 180°, as in the file. elevations is the request to the
// elevation API (elevation/api.ts); its error goes up, and then saveGpx in actions.ts makes the GPX without
// elevations. An empty track gives EmptyTrackError without a request.
export async function exportGpxWithElevations(
    track: TrackData,
    elevations: (points: readonly LatLng[]) => Promise<(number | null)[]>,
): Promise<ExportedFile> {
    const segments = splitLinesAt180(track.segments);
    if (segments.length === 0 && track.points.length === 0) {
        throw new EmptyTrackError();
    }
    const values = await elevations([...track.points, ...segments.flat()]);
    let next = track.points.length;
    const heights: GpxElevations = {
        points: values.slice(0, next),
        segments: segments.map((segment) => {
            next += segment.length;
            return values.slice(next - segment.length, next);
        }),
    };
    const name = fileBaseName(track.name);
    return {
        filename: `${name}.gpx`,
        content: toGpx(name, segments, track.points, heights),
        mimeType: FORMATS.gpx.mimeType,
    };
}

// File save: a link with download to a Blob
export function saveFile({ filename, content, mimeType }: ExportedFile): void {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
