import { getActivity } from '@/routing/brouter';
import type { LegMark, SegmentRoute } from '@/routing/line';
import type { GeoData, LatLng } from '@/tracks/model';
import { ARC_UNIT, parseNktkSequence } from '@/tracks/nktk';

// The last session of the old client (design switch-to-web-app, «Сессия старого клиента: последняя, один раз»). The
// old client kept the tab tracks in the IndexedDB sessions (src/lib/session-state and leaflet.control.sessions at
// commit 015be893): object store sessionData, keyPath sessionId, index mtime, record {sessionId, mtime, data: {hash,
// tracks, trackNames, routeMarkup}}. tracks is nktk strings joined with `/` (serializeTracks), routeMarkup is {legs:
// [[start key, end key, activityId], …]} with keys on the nktk grid (routeMarkupKey). The code only reads the
// database: it does not change or create it.

export const LEGACY_SESSIONS_DB = 'sessions';
const STORE = 'sessionData';
const MTIME_INDEX = 'mtime';

// routeMarkupKey of the old client: the same ~2.4 m grid as the nktk coordinates, so the point keys from the parsed
// string match the markup keys exactly
function markupKey(point: LatLng): string {
    return `${Math.round(point.lat * ARC_UNIT)},${Math.round(point.lng * ARC_UNIT)}`;
}

type LegacyLeg = [start: string, end: string, activityId: string];

function legacyLegs(markup: unknown): LegacyLeg[] {
    const legs = (markup as { legs?: unknown } | null | undefined)?.legs;
    if (!Array.isArray(legs)) {
        return [];
    }
    return legs.filter(
        (leg): leg is LegacyLeg =>
            Array.isArray(leg) && leg.length === 3 && leg.every((part) => typeof part === 'string'),
    );
}

// The markup of an old session → the markup of a segment (applyRouteMarkupToLine of the old client): from each
// waypoint, the code finds the nearest point at least one point further on that a markup leg connects to it; the
// points between them are route points. A leg of an unknown activity does not count: the markup of the new app does
// not allow a straight leg with intermediate points, so such points stay waypoints. Without a single leg, null: the
// segment opens as a polyline.
export function legacyRoute(points: readonly LatLng[], markup: unknown): SegmentRoute | null {
    const activities = new Map<string, string>();
    for (const [start, end, activityId] of legacyLegs(markup)) {
        if (getActivity(activityId)) {
            activities.set(`${start}|${end}`, activityId);
            activities.set(`${end}|${start}`, activityId);
        }
    }
    if (activities.size === 0) {
        return null;
    }
    const keys = points.map(markupKey);
    const waypoints = [0];
    const legs: LegMark[] = [];
    let i = 0;
    while (i < points.length - 1) {
        let end = -1;
        for (let k = i + 2; k < points.length; k++) {
            if (activities.has(`${keys[i]}|${keys[k]}`)) {
                end = k;
                break;
            }
        }
        if (end < 0) {
            legs.push({ state: 'straight' });
            i += 1;
        } else {
            legs.push({ state: 'routed', activity: activities.get(`${keys[i]}|${keys[end]}`) ?? '' });
            i = end;
        }
        waypoints.push(i);
    }
    return legs.some((leg) => leg.state === 'routed') ? { waypoints, legs } : null;
}

// A session record → tracks with markup. If the tracks string is corrupted, the result is what the parse could read
// from it (as with an nktk link).
export function legacySessionTracks(data: unknown): GeoData[] {
    const { tracks, routeMarkup } = (data ?? {}) as { tracks?: unknown; routeMarkup?: unknown };
    if (typeof tracks !== 'string' || !tracks) {
        return [];
    }
    return parseNktkSequence(tracks).map((track) => {
        const routes = track.segments.map((segment) => legacyRoute(segment, routeMarkup));
        return routes.some(Boolean) ? { ...track, routes } : track;
    });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Open the database of the old client without creating it: open without a version would create an empty database
// of version 1. So the code aborts the upgrade transaction, which comes only for a new database: open ends with
// AbortError, and the database does not appear.
function openExisting(factory: IDBFactory, name: string): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
        const request = factory.open(name);
        let missing = false;
        request.onupgradeneeded = () => {
            missing = true;
            request.transaction?.abort();
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
            if (missing) {
                // the error of the aborted upgrade is not an error of the app
                event.preventDefault();
                resolve(null);
                return;
            }
            reject(request.error);
        };
    });
}

interface LegacyRecord {
    mtime?: unknown;
    data?: { tracks?: unknown };
}

function hasTracks(record: LegacyRecord | null | undefined): record is LegacyRecord & { data: { tracks: string } } {
    return typeof record?.data?.tracks === 'string' && record.data.tracks !== '';
}

// data of the last session with tracks by mtime, or undefined (no database, no object store or no sessions with
// tracks). The old client deleted the record of a tab without tracks (clearState), but an empty string does no harm
// here either.
export async function readLatestLegacySession(
    factory: IDBFactory = indexedDB,
    name = LEGACY_SESSIONS_DB,
): Promise<unknown> {
    const db = await openExisting(factory, name);
    if (!db) {
        return undefined;
    }
    try {
        if (!db.objectStoreNames.contains(STORE)) {
            return undefined;
        }
        const store = db.transaction(STORE, 'readonly').objectStore(STORE);
        // from new to old by the index mtime, until the first session with tracks: do not load all 100 sessions into
        // memory
        const source = store.indexNames.contains(MTIME_INDEX) ? store.index(MTIME_INDEX) : null;
        if (!source) {
            const records = (await requestResult(store.getAll())) as LegacyRecord[];
            return records.filter(hasTracks).sort((a, b) => Number(b.mtime) - Number(a.mtime))[0]?.data;
        }
        return await new Promise((resolve, reject) => {
            const request = source.openCursor(null, 'prev');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(undefined);
                } else if (hasTracks(cursor.value)) {
                    resolve(cursor.value.data);
                } else {
                    cursor.continue();
                }
            };
        });
    } finally {
        db.close();
    }
}

// The source for the autosave: the tracks of the last session of the old client
export function legacySessionSource(factory?: () => IDBFactory, name?: string): () => Promise<GeoData[]> {
    return async () => legacySessionTracks(await readLatestLegacySession(factory ? factory() : indexedDB, name));
}
