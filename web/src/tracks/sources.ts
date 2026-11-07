import { viaCorsProxy } from '@/layers/catalog';

// Where tracks get the network: fetch and service addresses. It is a parameter, not a global: unit tests give fixture
// responses, browser tests give a stub through an App prop (design add-web-tracks, «Импорт по ссылке»).
export interface TrackSources {
    fetch: typeof fetch;
    corsProxyUrl: string;
    tracksStorageServer: string;
    // elevation API (spec elevation-api): GPX with elevations and the profile
    elevationsServer: string;
}

export function proxied(sources: TrackSources, url: string): string {
    return viaCorsProxy(sources.corsProxyUrl, url);
}

// fetch that does not throw: a network error (CORS, a lost connection) gives null, as a rejected xhr-promise does in
// the old client
export async function fetchOrNull(sources: TrackSources, url: string): Promise<Response | null> {
    try {
        return await sources.fetch(url);
    } catch {
        return null;
    }
}
