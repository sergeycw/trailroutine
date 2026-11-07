import { describe, expect, test, vi } from 'vitest';
import type { AutosaveStorage } from '@/autosave/autosave';
import { SAVED_VERSION } from '@/autosave/saved';
import { makeConfig } from '@/config';
import { geoData } from '@/tracks/model';
import { MOVED_TRACK, memoryStorage } from './fixture';
import { MOVED_KEY, moveOut } from './move-out';
import { openPayload } from './payload';

const config = makeConfig('clone');
const OLD = { hostname: 'nakarte-routing.pages.dev', pathname: '/', search: '', hash: '#m=12/41.7/44.8' };

function autosave(record: unknown, legacy?: AutosaveStorage['legacy']): AutosaveStorage {
    return { load: async () => record, save: async () => {}, ...(legacy ? { legacy } : {}) };
}

// the track storage of the test: POST /track/<key> keeps the body
function trackStorage(status = 200) {
    const bodies = new Map<string, string>();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const key = String(input).split('/track/')[1];
        bodies.set(key, String(init?.body));
        return new Response(null, { status });
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch.mock.calls, bodies };
}

describe('Move from the old address', () => {
    test('another host does not move', async () => {
        const server = trackStorage();
        const result = await moveOut({
            location: { ...OLD, hostname: '762b3e5f.nakarte-routing.pages.dev' },
            config,
            storage: autosave({ version: SAVED_VERSION, tracks: [MOVED_TRACK] }),
            localStorage: memoryStorage(),
            fetch: server.fetch,
        });
        expect(result).toBeNull();
        expect(server.calls).toHaveLength(0);
    });

    test('Old address without saved data', async () => {
        const server = trackStorage();
        const result = await moveOut({
            location: { ...OLD, hash: '#m=12/41.7/44.8&nktl=KEY' },
            config,
            storage: autosave(undefined, async () => []),
            localStorage: memoryStorage(),
            fetch: server.fetch,
        });
        expect(result).toBe('https://trailroutine.com/#m=12/41.7/44.8&nktl=KEY');
        expect(server.calls).toHaveLength(0);
    });

    test('Old address with saved tracks', async () => {
        const server = trackStorage();
        const local = memoryStorage({ 'nakarte-web:layers': '{"selection":"Of"}' });
        const result = await moveOut({
            location: { ...OLD, pathname: '/', search: '?x=1' },
            config,
            storage: autosave({ version: SAVED_VERSION, tracks: [MOVED_TRACK] }),
            localStorage: local,
            fetch: server.fetch,
        });
        const match = /^https:\/\/trailroutine\.com\/\?x=1#m=12\/41\.7\/44\.8&move=([\w-]{22})\.([\w-]{43})$/u.exec(
            result ?? '',
        );
        expect(match).not.toBeNull();
        const [, key, secret] = match as RegExpExecArray;
        expect(server.calls).toHaveLength(1);
        expect(String(server.calls[0][0])).toBe(`${config.tracksStorageServer}/track/${key}`);
        const payload = await openPayload(server.bodies.get(key) as string, secret);
        expect(payload.tracks[0].segments[0]).toEqual(MOVED_TRACK.segments[0]);
        expect(payload.settings).toEqual({ 'nakarte-web:layers': '{"selection":"Of"}' });
        expect(local.getItem(MOVED_KEY)).toBe(`${key}.${secret}`);
    });

    test('Second visit to the old address', async () => {
        const server = trackStorage();
        const move = `${'a'.repeat(22)}.${'b'.repeat(43)}`;
        const result = await moveOut({
            location: { ...OLD, hash: '' },
            config,
            storage: autosave({ version: SAVED_VERSION, tracks: [MOVED_TRACK] }),
            localStorage: memoryStorage({ [MOVED_KEY]: move }),
            fetch: server.fetch,
        });
        expect(result).toBe(`https://trailroutine.com/#move=${move}`);
        expect(server.calls).toHaveLength(0);
    });

    test('Track storage fails', async () => {
        const server = trackStorage(500);
        const local = memoryStorage();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await moveOut({
            location: OLD,
            config,
            storage: autosave({ version: SAVED_VERSION, tracks: [MOVED_TRACK] }),
            localStorage: local,
            fetch: server.fetch,
        });
        expect(result).toBeNull();
        expect(local.getItem(MOVED_KEY)).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test('the last session of the old client moves when there is no own record', async () => {
        const server = trackStorage();
        const session = geoData('Old client track', {
            segments: [
                [
                    { lat: 42.6, lng: 44.6 },
                    { lat: 42.7, lng: 44.7 },
                ],
            ],
        });
        const result = await moveOut({
            location: OLD,
            config,
            storage: autosave(undefined, async () => [session]),
            localStorage: memoryStorage(),
            fetch: server.fetch,
        });
        const [key, secret] = (result?.split('move=')[1] ?? '').split('.');
        const payload = await openPayload(server.bodies.get(key) as string, secret);
        expect(payload.tracks.map((track) => track.name)).toEqual(['Old client track']);
    });
});
