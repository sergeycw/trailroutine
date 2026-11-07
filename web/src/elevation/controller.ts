import { routePending } from '@/routing/line';
import type { AppState, AppStore, ProfileTarget } from '@/state/store';
import type { LatLng, Track } from '@/tracks/model';
import { type ElevationSource, errorReason, fetchElevations } from './api';
import { sampleSegments } from './profile';

// The elevation profile without React (design add-web-elevation-profile, «Профиль следует за треком»): for the
// target from the store (a track or its segment), it builds the samples, requests the elevations and writes the
// result to the store. The profile follows the track: a change of track.segments (the store changes the array on
// each geometry edit) builds the profile again when there are no changes for delay ms and the profile lines have no
// pending segments. A delete of the track closes the profile. A segment profile also closes when the number of
// segments changes (the index can now point to a different segment).

type Notify = (title: string, type?: 'error' | 'success') => void;

export interface ElevationProfileDeps {
    store: AppStore;
    source: ElevationSource;
    notify: Notify;
    // the pause before the profile builds again after a track change, ms
    delay?: number;
}

function linesOf(track: Track, target: ProfileTarget): LatLng[][] | null {
    if (target.segment === null) {
        return track.segments;
    }
    const line = track.segments[target.segment];
    return line ? [line] : null;
}

function builtLines(track: Track, target: ProfileTarget) {
    const lines = target.segment === null ? track.segments : track.segments[target.segment];
    return { lines, count: track.segments.length };
}

function hasPending(track: Track, target: ProfileTarget): boolean {
    const indexes = target.segment === null ? track.segments.map((_, i) => i) : [target.segment];
    return indexes.some((i) => routePending(track.routes?.[i]));
}

export function createElevationProfile({ store, source, notify, delay = 1000 }: ElevationProfileDeps) {
    const state = () => store.getState();
    // the lines from which the code built the current profile: for a track profile, the array of segments; for a
    // segment profile, the segment itself (the editor writes a new array of segments on each edit, but keeps the
    // references to the segments that did not change). A change is a reason to build again.
    let builtFrom: { lines: readonly unknown[]; count: number } | null = null;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function cancel() {
        request?.abort();
        request = null;
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    }

    function close() {
        cancel();
        builtFrom = null;
        state().setProfile(null);
    }

    // Builds the profile of the target from the track in the store. false means there is nothing to build from (no
    // track, no lines, or their length is 0).
    function build(target: ProfileTarget): boolean {
        const track = state().tracks.find((item) => item.id === target.trackId);
        const lines = track && linesOf(track, target);
        if (!track || !lines) {
            return false;
        }
        const samples = sampleSegments(lines);
        if (samples.points.length < 2) {
            return false;
        }
        cancel();
        builtFrom = builtLines(track, target);
        const previous = state().profileData;
        state().setProfileData({
            samples: previous?.values ? previous.samples : samples,
            values: previous?.values ?? null,
            updating: true,
            error: null,
        });
        const controller = new AbortController();
        request = controller;
        fetchElevations(samples.points, source, controller.signal).then(
            (values) => {
                if (request !== controller) {
                    return;
                }
                request = null;
                // new points: the previous cursor and selection point to wrong places
                store.setState({ profileCursor: null, profileSelection: null });
                state().setProfileData({ samples, values, updating: false, error: null });
            },
            (error) => {
                if (request !== controller) {
                    return;
                }
                request = null;
                state().setProfileData({
                    samples: previous?.values ? previous.samples : samples,
                    values: previous?.values ?? null,
                    updating: false,
                    error: errorReason(error),
                });
            },
        );
        return true;
    }

    function rebuildLater() {
        if (timer !== null) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            const target = state().profile;
            const track = target && state().tracks.find((item) => item.id === target.trackId);
            // a pending segment is a straight placeholder line: wait for the router answer, which changes the track
            // again
            if (!target || !track || hasPending(track, target)) {
                return;
            }
            if (!build(target)) {
                close();
            }
        }, delay);
    }

    function onChange(next: AppState, prev: AppState) {
        const target = next.profile;
        if (!target || next.tracks === prev.tracks || !builtFrom) {
            return;
        }
        const track = next.tracks.find((item) => item.id === target.trackId);
        if (!track) {
            close();
            return;
        }
        if (target.segment !== null && track.segments.length !== builtFrom.count) {
            close();
            return;
        }
        const lines = builtLines(track, target);
        if (lines.lines === builtFrom.lines) {
            return;
        }
        builtFrom = lines;
        // the previous graph with an indicator: the rebuild waits for the pause and for the router answer
        const data = state().profileData;
        if (data && !data.updating) {
            state().setProfileData({ ...data, updating: true });
        }
        rebuildLater();
    }

    return {
        // The profile of a track (segment null) or of a segment; an empty one gives the message Track is empty, as in
        // the old client
        open(trackId: string, segment: number | null = null) {
            cancel();
            const target = { trackId, segment };
            state().setProfile(target);
            if (!build(target)) {
                close();
                notify('Track is empty', 'error');
            }
        },
        close,
        retry() {
            const target = state().profile;
            if (target && !build(target)) {
                close();
            }
        },
        // the store subscription is in an effect of App, not at the creation: Strict Mode creates the object two
        // times
        start() {
            const unsubscribe = store.subscribe(onChange);
            return () => {
                unsubscribe();
                cancel();
            };
        },
    };
}

export type ElevationProfileController = ReturnType<typeof createElevationProfile>;
