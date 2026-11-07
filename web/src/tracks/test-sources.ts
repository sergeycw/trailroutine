import type { TrackSources } from './sources';

// Fake network for track unit tests: responses by exact address, a network error for other addresses (no real network)

export const TEST_PROXY = 'https://proxy.test/';
export const TEST_STORAGE = 'https://tracks.test';
export const TEST_ELEVATION = 'https://elevation.test/';

export interface FakeResponse {
    status?: number;
    body: string | Uint8Array;
}

export function fakeSources(responses: Record<string, FakeResponse> = {}) {
    const requested: string[] = [];
    const sources: TrackSources = {
        corsProxyUrl: TEST_PROXY,
        tracksStorageServer: TEST_STORAGE,
        elevationsServer: TEST_ELEVATION,
        fetch: async (input) => {
            const url = String(input);
            requested.push(url);
            const response = responses[url];
            if (!response) {
                throw new TypeError(`Failed to fetch ${url}`);
            }
            const body = typeof response.body === 'string' ? response.body : new Blob([response.body as BlobPart]);
            return new Response(body, { status: response.status ?? 200 });
        },
    };
    return { sources, requested };
}

// Address through the proxy, as the import makes it: <proxy>https/host/path
export function viaTestProxy(url: string) {
    return TEST_PROXY + url.replace(/^(https?):\/\//u, '$1/');
}
