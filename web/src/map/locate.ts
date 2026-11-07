import type { LatLng } from '@/tracks/model';

// The last position of the user (design add-web-search-panoramas, «Геолокация»): moveMapToCurrentLocation of the old
// client (src/lib/leaflet.control.locate/index.js). It is written on each received position and erased on an access
// denial. An own key; without it, the key of the old client is read (the same origin), and the code does not touch it:
// a forgotten position is written as null, so a fallback to the old key does not bring it back.

export const POSITION_KEY = 'nakarte-web:position';
export const LEGACY_POSITION_KEY = 'leaflet_locate_position';

function parse(text: string | null, lngField: 'lng' | 'lon'): LatLng | null {
    try {
        const value = JSON.parse(text ?? 'null') as Record<string, unknown> | null;
        const lat = Number(value?.lat);
        const lng = Number(value?.[lngField]);
        // zeros mean "no position", as the check `lat && lon` of the old client
        if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            return null;
        }
        return { lat, lng };
    } catch {
        return null;
    }
}

export function loadPosition(storage: Storage | null): LatLng | null {
    if (!storage) {
        return null;
    }
    try {
        const own = storage.getItem(POSITION_KEY);
        if (own !== null) {
            return parse(own, 'lng');
        }
        return parse(storage.getItem(LEGACY_POSITION_KEY), 'lon');
    } catch {
        return null;
    }
}

export function savePosition(storage: Storage | null, { lat, lng }: LatLng) {
    try {
        storage?.setItem(POSITION_KEY, JSON.stringify({ lat, lng }));
    } catch {
        // the storage is not available: the position is not remembered
    }
}

export function forgetPosition(storage: Storage | null) {
    try {
        storage?.setItem(POSITION_KEY, 'null');
    } catch {
        // the storage is not available
    }
}

// A short request of the current position at the visit (timeout 500 ms, without high accuracy), only if a position is
// already remembered: this means the permission was given, and the browser does not show a prompt
export function refreshPosition(
    geolocation: Geolocation | undefined,
    storage: Storage | null,
    onPosition: (position: LatLng) => void,
) {
    if (!geolocation || !loadPosition(storage)) {
        return;
    }
    geolocation.getCurrentPosition(
        (position) => {
            const latlng = { lat: position.coords.latitude, lng: position.coords.longitude };
            savePosition(storage, latlng);
            onPosition(latlng);
        },
        (error) => {
            if (error.code === error.PERMISSION_DENIED) {
                forgetPosition(storage);
            }
        },
        { enableHighAccuracy: false, timeout: 500, maximumAge: 0 },
    );
}
