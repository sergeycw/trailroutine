import md5 from 'blueimp-md5';
import { simplifyRouted } from '@/routing/line';
import { formatHash, parseHash, withParam } from '@/state/hash';
import { simplify } from './geometry';
import { TRACK_PARAMS } from './links';
import type { Track } from './model';
import { saveNktk } from './nktk';
import type { TrackSources } from './sources';

// Ссылка на треки nktl= (copyTracksLinkToClipboard старого клиента, контракт — спека track-storage): тело — строки
// nktk через `/`, ключ — base64url(md5(тело)) без `=`. Старый клиент отдавал ссылку до ответа хранилища; здесь —
// только после 200 (аудит системного дизайна, п. 2; design add-web-tracks, «Ссылка — после ответа хранилища»).

// forceVisible — видимость в ссылке: «Copy link for track» пишет трек видимым (trackToString(track, forceVisible)).
// Отрезок с разметкой маршрута упрощается без опорных точек, и разметка уходит в ссылку (design add-web-autosave).
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

// Тот же ключ, что считает Worker (workers/tracks/src/key.js, тоже blueimp-md5)
export function trackKey(body: string): string {
    return btoa(md5(body, undefined, true))
        .replace(/\//gu, '_')
        .replace(/\+/gu, '-')
        .replace(/=/gu, '');
}

// Адрес ссылки: текущий адрес приложения без поиска (q, r — keysToExcludeOnCopyLink старого клиента) и без
// параметров треков (их место займёт nktl)
export function shareLink(location: { origin: string; pathname: string; hash: string }, key: string): string {
    let params = parseHash(location.hash);
    for (const name of ['q', 'r', ...TRACK_PARAMS]) {
        params = withParam(params, name, null);
    }
    params = withParam(params, 'nktl', [key]);
    return `${location.origin}${location.pathname}#${formatHash(params)}`;
}

export class ShareError extends Error {}

// POST в хранилище; ошибка — ShareError с текстом для «Error making link: …»
export async function storeTracks(
    body: string,
    sources: Pick<TrackSources, 'fetch' | 'tracksStorageServer'>,
): Promise<string> {
    const key = trackKey(body);
    let response: Response;
    try {
        // строка в теле — text/plain, «простой» CORS-запрос без preflight, как xhr старого клиента
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
