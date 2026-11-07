import type { LatLng } from '@/tracks/model';
import type { Elevation } from './profile';

// Requests to the elevation API (spec elevation-api; ElevationProvider of the old client,
// src/lib/elevations/index.js): a POST of «lat lng» lines with six decimals; the answer is one line per point, an
// elevation or NULL. Chunks of 10 000 points are the limit of the Worker (10 000 points and 250 000 bytes: a line is
// not longer than 23 bytes, so a chunk fits), one after another, as in the old client. Without credentials, unlike
// withCredentials of the old client: the Worker reflects Origin also without them, and it does not need cookies
// (design add-web-elevation-profile, «Модули»).

export const ELEVATION_CHUNK = 10000;

export class ElevationError extends Error {}

export interface ElevationSource {
    fetch: typeof fetch;
    url: string;
}

// The longitude for the API: outside [-180, 180) the Worker gives NULL (spec elevation-api, «Нет данных»). The code
// does not change a longitude in the range: the wrap arithmetic adds noise in its last digit (as wrapped in
// tracks/actions.ts), and 180 → -180.
export function requestLng(lng: number): number {
    return lng >= -180 && lng < 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function requestBody(points: readonly LatLng[]): string {
    return points.map((p) => `${p.lat.toFixed(6)} ${requestLng(p.lng).toFixed(6)}`).join('\n');
}

export function parseResponse(text: string, expected: number): Elevation[] {
    if (expected === 0) {
        return [];
    }
    const lines = text.split('\n');
    // the Worker does not add a trailing line break; if it appears, do not count it as a line
    if (lines.length === expected + 1 && lines[expected] === '') {
        lines.pop();
    }
    if (lines.length !== expected) {
        throw new ElevationError('unexpected response');
    }
    return lines.map((line) => {
        if (line === 'NULL') {
            return null;
        }
        const value = Number.parseFloat(line);
        if (!Number.isFinite(value)) {
            throw new ElevationError('unexpected response');
        }
        return value;
    });
}

function statusReason(status: number): string {
    if (status === 429) {
        return 'too many requests, try again in a minute';
    }
    // the chunks fit in the limit by the number of points and bytes, so this is more than 512 storage reads: the
    // points are far apart
    if (status === 413) {
        return 'track covers too large an area';
    }
    return `HTTP ${status}`;
}

export async function fetchElevations(
    points: readonly LatLng[],
    source: ElevationSource,
    signal?: AbortSignal,
): Promise<Elevation[]> {
    const result: Elevation[] = [];
    for (let i = 0; i < points.length; i += ELEVATION_CHUNK) {
        const chunk = points.slice(i, i + ELEVATION_CHUNK);
        let response: Response;
        try {
            response = await source.fetch(source.url, { method: 'POST', body: requestBody(chunk), signal });
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }
            throw new ElevationError('network error');
        }
        if (!response.ok) {
            throw new ElevationError(statusReason(response.status));
        }
        let text: string;
        try {
            text = await response.text();
        } catch (error) {
            if (signal?.aborted) {
                throw error;
            }
            throw new ElevationError('network error');
        }
        result.push(...parseResponse(text, chunk.length));
    }
    return result;
}

export function errorReason(error: unknown): string {
    return error instanceof ElevationError ? error.message : String(error);
}
