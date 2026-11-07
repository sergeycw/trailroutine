// The placemark of a found place and its address parameter r=lat/lng/name: the format of PlacemarkHashStateInterface
// of the old client (src/lib/leaflet.placemark/index.js): coordinates toFixed(6), the name through encodeURIComponent
// (the address values are split by "/", and a "/" in the name is encoded). «Copy link» does not include r=
// (keysToExcludeOnCopyLink, tracks/share.ts).

export interface Placemark {
    lat: number;
    lng: number;
    title: string;
}

export const PLACEMARK_PARAM = 'r';

export function parsePlacemark(values: readonly string[] | undefined): Placemark | null {
    if (!values?.length) {
        return null;
    }
    const lat = Number.parseFloat(values[0]);
    const lng = Number.parseFloat(values[1] ?? '');
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return null;
    }
    let title = values[2] ?? '';
    try {
        title = decodeURIComponent(title);
    } catch {
        // a broken % sequence: the name stays as it is, the placemark is not lost
    }
    return { lat, lng, title };
}

export function formatPlacemark({ lat, lng, title }: Placemark): string[] {
    return [lat.toFixed(6), lng.toFixed(6), encodeURIComponent(title)];
}
