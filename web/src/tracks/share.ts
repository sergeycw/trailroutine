import md5 from 'blueimp-md5';
import { simplifyRouted } from '@/routing/line';
import { formatHash, parseHash, withParam } from '@/state/hash';
import { simplify } from './geometry';
import { TRACK_PARAMS } from './links';
import type { Track } from './model';
import { saveNktk } from './nktk';
import type { TrackSources } from './sources';

// Link to tracks nktl= (copyTracksLinkToClipboard of the old client, contract: spec track-storage): the body is nktk
// strings joined with `/`, the key is base64url(md5(body)) without `=`. The old client gave the link before the
// storage response; here only after 200 (system design audit, item 2; design add-web-tracks, «Ссылка — после ответа
// хранилища»).

// forceVisible is the visibility in the link: «Copy link for track» writes the track as visible
// (trackToString(track, forceVisible)). A segment with route markup is simplified, its waypoints stay, and the markup
// goes into the link (design add-web-autosave).
export function shareBody(tracks: readonly Track[], forceVisible = false): string {
    return tracks
        .map((track) => {
            const lines = track.segments.map(
                (line, i) => simplifyRouted(line, track.routes?.[i]) ?? { points: simplify(line), route: null },
            );
            return saveNktk({
                ...track,
                segments: lines.map((line) => line.points),
                routes: lines.map((line) => line.route),
                hidden: forceVisible ? false : !track.visible,
            });
        })
        .join('/');
}

// The same key that the Worker calculates (workers/tracks/src/key.js, also blueimp-md5)
export function trackKey(body: string): string {
    return btoa(md5(body, undefined, true))
        .replace(/\//gu, '_')
        .replace(/\+/gu, '-')
        .replace(/=/gu, '');
}

// Link address: the current app address without the search (q, r: keysToExcludeOnCopyLink of the old client) and
// without the track parameters (nktl takes their place)
export function shareLink(location: { origin: string; pathname: string; hash: string }, key: string): string {
    let params = parseHash(location.hash);
    for (const name of ['q', 'r', ...TRACK_PARAMS]) {
        params = withParam(params, name, null);
    }
    params = withParam(params, 'nktl', [key]);
    return `${location.origin}${location.pathname}#${formatHash(params)}`;
}

export class ShareError extends Error {}

// POST to the storage; an error gives ShareError with the text for «Error making link: …»
export async function storeTracks(
    body: string,
    sources: Pick<TrackSources, 'fetch' | 'tracksStorageServer'>,
): Promise<string> {
    const key = trackKey(body);
    let response: Response;
    try {
        // the body is a string, text/plain: a "simple" CORS request without preflight, as xhr of the old client
        response = await sources.fetch(`${sources.tracksStorageServer}/track/${key}`, { method: 'POST', body });
    } catch {
        throw new ShareError('network error');
    }
    if (response.status === 413) {
        throw new ShareError('track is too big');
    }
    if (!response.ok) {
        throw new ShareError(`server responded with ${response.status}`);
    }
    return key;
}
