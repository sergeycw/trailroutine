import { ElevationError, fetchElevations } from '@/elevation/api';
import { reverseRoute, settledRoute } from '@/routing/line';
import type { AppStore } from '@/state/store';
import type { TrackParams } from '@/state/sync';
import { EmptyTrackError, type ExportedFile, exportGpxWithElevations, exportTrack, saveFile } from './export';
import { boundsOf, wrapLng } from './geometry';
import { prepareImport } from './import-result';
import { loadFromUrl } from './import-url';
import { loadTrackParam } from './links';
import { type GeoData, geoData, type LatLng, type Track, type TrackColor, type Waypoint } from './model';
import { parseGeoFile } from './parsers';
import { ShareError, shareBody, shareLink, storeTracks } from './share';
import type { TrackSources } from './sources';

// Track list actions without React: components call them, tests give the network, the clipboard and notices.

export type Notify = (title: string, type?: 'error' | 'success') => void;

export interface TrackActionsDeps {
    store: AppStore;
    sources: TrackSources;
    notify: Notify;
    location: () => { origin: string; pathname: string; hash: string };
    // clipboard write; gets the link promise at once, in the click handler (design add-web-tracks,
    // «Ссылка — после ответа хранилища»)
    writeClipboard?: (text: Promise<string>) => Promise<void>;
    // end of the autosave restore: tracks from the address and files go after the restored tracks (design
    // add-web-autosave, «Восстановление и треки из адреса»)
    restored?: Promise<unknown>;
    // file save (by default, a download link): unit tests give their own write
    save?: typeof saveFile;
    // how long «Save as GPX» waits for the elevation API, ms; unit tests set their own milliseconds
    elevationTimeout?: number;
}

// Elevation wait for «Save as GPX» (an agent decision, design trim-track-menus): the API usually responds in a fraction
// of a second, but without a timeout a stuck request would leave the user without a file. On timeout, GPX without
// elevations, as on an API error
const ELEVATION_TIMEOUT_MS = 10_000;

// ClipboardItem with a promise: Safari keeps the user gesture during the storage request, Chromium awaits the promise
export function writeClipboardItem(text: Promise<string>): Promise<void> {
    const blob = text.then((value) => new Blob([value], { type: 'text/plain' }));
    return navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
}

// New track point name: the next three-digit number after the largest among names like «001…» (getNewPointName of
// the old client takes the number after the last point in order, and after renames the number could repeat); after
// 999, an empty name, as in the old client
export function nextPointName(points: readonly Waypoint[]): string {
    let max = 0;
    for (const point of points) {
        if (/^\d{3}([^\d.]|$)/u.test(point.name)) {
            max = Math.max(max, Number.parseInt(point.name, 10));
        }
    }
    return max >= 999 ? '' : String(max + 1).padStart(3, '0');
}

// Click longitude in a neighbor world copy of MapLibre goes into ±180 (latlng.wrap() of the old client). A longitude
// within the range stays as it is: the wrapLng arithmetic adds noise in the last digit (44.8 → 44.799999999999955).
function wrapped(latlng: LatLng): LatLng {
    return latlng.lng >= -180 && latlng.lng <= 180 ? latlng : { lat: latlng.lat, lng: wrapLng(latlng.lng) };
}

// Copy coordinates of the old client: SIGNED_DEGREES (toFixed(5)) from latlng.wrap()
export function pointCoordinates(point: LatLng): string {
    const { lat, lng } = wrapped(point);
    return `${lat.toFixed(5)} ${lng.toFixed(5)}`;
}

function trackBounds(tracks: readonly Pick<GeoData, 'segments' | 'points'>[]) {
    return boundsOf(tracks.flatMap((track) => [...track.segments.flat(), ...track.points]));
}

export function createTrackActions({
    store,
    sources,
    notify,
    location,
    writeClipboard = writeClipboardItem,
    restored = Promise.resolve(),
    save: saveToDisk = saveFile,
    elevationTimeout = ELEVATION_TIMEOUT_MS,
}: TrackActionsDeps) {
    const state = () => store.getState();
    // tracks whose GPX waits for the elevation API: a second press on «Save as GPX» does not give a second file
    const savingGpx = new Set<string>();

    async function load(data: Promise<GeoData[]>, fitView = false): Promise<Track[]> {
        state().changeLoadingTracks(1);
        try {
            const { tracks, messages } = prepareImport(await data);
            await restored;
            const added = state().addTracks(tracks);
            for (const message of messages) {
                notify(message, 'error');
            }
            const bounds = fitView ? trackBounds(added) : null;
            if (bounds) {
                state().requestBounds(bounds);
            }
            return added;
        } finally {
            state().changeLoadingTracks(-1);
        }
    }

    async function copyLink(tracks: readonly Track[], forceVisible = false) {
        if (tracks.length === 0) {
            notify('No tracks to copy', 'error');
            return;
        }
        const link = storeTracks(shareBody(tracks, forceVisible), sources).then((key) => shareLink(location(), key));
        let clipboard: Promise<void>;
        try {
            clipboard = writeClipboard(link);
        } catch (error) {
            clipboard = Promise.reject(error);
        }
        let text: string;
        try {
            text = await link;
        } catch (error) {
            clipboard.catch(() => {});
            const message = error instanceof ShareError ? error.message : String(error);
            notify(`Error making link: ${message}`, 'error');
            return;
        }
        try {
            await clipboard;
            notify('Link copied', 'success');
        } catch {
            // the clipboard is not available (no permission, no ClipboardItem): the link goes to a window
            state().setCopyFallback({ title: 'Link to tracks', text });
        }
    }

    function save(file: () => Parameters<typeof saveFile>[0]) {
        try {
            saveToDisk(file());
        } catch (error) {
            if (!(error instanceof EmptyTrackError)) {
                throw error;
            }
            notify(error.message, 'error');
        }
    }

    // track copy with route markup: the waypoint indexes are correct for the copy too (lines are not simplified)
    function copyOf(track: Track): GeoData {
        return geoData(track.name, {
            segments: track.segments.map((line) => line.map((p) => ({ ...p }))),
            points: track.points.map((p) => ({ ...p })),
            routes: track.segments.map((_, i) => settledRoute(track.routes?.[i])),
        });
    }

    // A track point is edited by object, not by index: the index is found at the time of the action, a missing point
    // gives nothing (design add-web-line-tools, «Точки трека»)
    function updatePoint(trackId: string, point: Waypoint, change: (points: Waypoint[], index: number) => void) {
        const track = state().tracks.find((item) => item.id === trackId);
        const index = track?.points.indexOf(point) ?? -1;
        if (!track || index < 0) {
            return;
        }
        const points = track.points.slice();
        change(points, index);
        state().updateTrack(trackId, { points });
    }

    return {
        // Track points (spec tracks, «Добавление точек трека», «Меню точки трека»). Adding is the store mode pointTool:
        // a map click calls addPoint, the name window is pointDialog.
        startAddPoint(track: Track) {
            if (!track.visible) {
                state().updateTrack(track.id, { visible: true });
            }
            state().setPointTool({ kind: 'add', trackId: track.id });
        },
        startMovePoint: (trackId: string, point: Waypoint) => state().setPointTool({ kind: 'move', trackId, point }),
        stopPointTool: () => state().setPointTool(null),
        // point name window (Rename in the point menu)
        startRenamePoint: (trackId: string, point: Waypoint) => state().setPointDialog({ trackId, point }),
        // new point with a ready number or the name of the search placemark; the name window opens at once
        // (createNewPoint of the old client)
        addPoint(trackId: string, latlng: LatLng, name?: string): Waypoint | null {
            const track = state().tracks.find((item) => item.id === trackId);
            if (!track) {
                return null;
            }
            const { lat, lng } = wrapped(latlng);
            const point: Waypoint = { lat, lng, name: name ?? nextPointName(track.points) };
            state().updateTrack(trackId, { points: [...track.points, point] });
            state().setPointDialog({ trackId, point });
            return point;
        },
        // an empty name is allowed, as in query of the old client
        renamePoint: (trackId: string, point: Waypoint, name: string) =>
            updatePoint(trackId, point, (points, index) => {
                points[index] = { ...point, name };
            }),
        movePoint(trackId: string, point: Waypoint, latlng: LatLng) {
            updatePoint(trackId, point, (points, index) => {
                points[index] = { ...point, ...wrapped(latlng) };
            });
            state().setPointTool(null);
        },
        removePoint: (trackId: string, point: Waypoint) =>
            updatePoint(trackId, point, (points, index) => {
                points.splice(index, 1);
            }),
        async copyPointCoordinates(point: LatLng) {
            const text = pointCoordinates(point);
            try {
                await writeClipboard(Promise.resolve(text));
                notify('Coordinates copied', 'success');
            } catch {
                state().setCopyFallback({ title: 'Point coordinates', text });
            }
        },
        openFiles: (files: readonly File[]) =>
            load(
                Promise.all(
                    files.map(async (file) => parseGeoFile(file.name, new Uint8Array(await file.arrayBuffer()))),
                ).then((parsed) => parsed.flat()),
            ),
        // from the search box: a result selection moves the map, so the view goes to the track
        // (design search-track-links)
        openUrl: (url: string) => load(loadFromUrl(url.trim(), sources), true),
        openTrackParams: (params: TrackParams, fitView: boolean) =>
            load(
                Promise.all(params.map(([key, values]) => loadTrackParam(key, values, sources))).then((loaded) =>
                    loaded.flat(),
                ),
                fitView,
            ),
        // new track from the visible ones: their segments and points, the name of the first visible track (the old
        // client asked for a name; here the user can change it with «Rename»)
        newTrackFromVisible: () => {
            const visible = state().tracks.filter((track) => track.visible);
            if (visible.length === 0) {
                return;
            }
            const copies = visible.map(copyOf);
            state().addTracks([
                geoData(visible[0].name, {
                    segments: copies.flatMap((copy) => copy.segments),
                    points: copies.flatMap((copy) => copy.points),
                    routes: copies.flatMap((copy) => copy.routes ?? []),
                }),
            ]);
        },
        showTrack: (track: Track) => {
            const bounds = trackBounds([track]);
            if (bounds) {
                state().requestBounds(bounds);
            }
        },
        rename: (track: Track, name: string) => {
            if (name.trim()) {
                state().updateTrack(track.id, { name });
            }
        },
        duplicate: (track: Track) => state().addTracks([copyOf(track)]),
        // the markup reverses together with the segments: a routed segment stays routed (spec tracks,
        // «Развернуть проложенный трек»)
        reverse: (track: Track) =>
            state().updateTrack(track.id, {
                segments: track.segments.map((line) => [...line].reverse()),
                routes: track.segments.map((line, i) => reverseRoute(track.routes?.[i], line.length)),
            }),
        remove: (track: Track) => state().removeTracks([track.id]),
        removeAll: () => state().removeTracks(state().tracks.map((track) => track.id)),
        removeHidden: () =>
            state().removeTracks(
                state()
                    .tracks.filter((t) => !t.visible)
                    .map((t) => t.id),
            ),
        // Shift+click on the checkbox shows only this track (onTrackCheckboxClicked of the old client)
        setVisible: (track: Track, visible: boolean, only = false) => {
            if (!only) {
                state().updateTrack(track.id, { visible });
                return;
            }
            for (const other of state().tracks) {
                state().updateTrack(other.id, { visible: other.id === track.id });
            }
        },
        setColor: (track: Track, color: TrackColor) => state().updateTrack(track.id, { color }),
        // distance ticks (switchMeasureTicksVisibility of the old client)
        setMeasureTicks: (track: Track, measureTicksShown: boolean) =>
            state().updateTrack(track.id, { measureTicksShown }),
        // «Save as GPX» always has elevations (the owner 2026-10-29, design trim-track-menus; spec track-files,
        // «GPX с высотами»): while the elevation API requests go on, a loading indicator turns on the Tracks button
        // and on the editor «Share track». An API error or a timeout gives the same GPX without <ele> and without a
        // message: the user needs the file without the network too, and the menu does not mention elevations
        async saveGpx(track: Track) {
            if (savingGpx.has(track.id)) {
                return;
            }
            let file: ExportedFile;
            try {
                file = exportTrack(track, 'gpx');
            } catch (error) {
                if (!(error instanceof EmptyTrackError)) {
                    throw error;
                }
                notify(error.message, 'error');
                return;
            }
            savingGpx.add(track.id);
            state().changeLoadingTracks(1);
            const signal = AbortSignal.timeout(elevationTimeout);
            try {
                file = await exportGpxWithElevations(track, (points) =>
                    fetchElevations(points, { fetch: sources.fetch, url: sources.elevationsServer }, signal),
                );
            } catch (error) {
                // fetchElevations gives an aborted signal as the original error, not as ElevationError
                if (!(error instanceof ElevationError) && !signal.aborted) {
                    throw error;
                }
            } finally {
                savingGpx.delete(track.id);
                state().changeLoadingTracks(-1);
            }
            saveToDisk(file);
        },
        saveKml: (track: Track) => save(() => exportTrack(track, 'kml')),
        copyTrackLink: (track: Track) => copyLink([track], true),
        copyAllLink: () => copyLink(state().tracks),
        copyVisibleLink: () => copyLink(state().tracks.filter((track) => track.visible)),
    };
}

export type TrackActions = ReturnType<typeof createTrackActions>;
