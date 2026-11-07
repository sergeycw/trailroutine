import { describe, expect, test, vi } from 'vitest';
import { SAVED_VERSION, type SavedSet } from '@/autosave/saved';
import { makeConfig } from '@/config';
import { MOVED_TRACK, memoryStorage } from './fixture';
import { MOVE_FAILED, MOVED_IN_KEY, type MoveInDeps, moveIn } from './move-in';
import { sealPayload } from './payload';

const config = makeConfig('clone');
const OLD_REFERRER = 'https://nakarte-routing.pages.dev/';
const OWN_TRACK = { ...MOVED_TRACK, name: 'Made on trailroutine.com' };

// one moved payload in the track storage of the test; GET /track/<key> returns it
async function movedData(settings: Record<string, string> = {}) {
    const { body, secret } = await sealPayload({ tracks: [MOVED_TRACK], settings });
    const key = 'k'.repeat(22);
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
        String(input) === `${config.tracksStorageServer}/track/${key}`
            ? new Response(body)
            : new Response('Track not found', { status: 404 }),
    );
    return { move: `${key}.${secret}`, fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch.mock.calls };
}

function page(hash: string, deps: Partial<MoveInDeps> & Pick<MoveInDeps, 'fetch'>) {
    let record: SavedSet | undefined = { version: SAVED_VERSION, tracks: [OWN_TRACK] };
    const replaceState = vi.fn();
    const all: MoveInDeps = {
        location: { pathname: '/', search: '', hash },
        history: { state: null, replaceState },
        referrer: OLD_REFERRER,
        config,
        storage: {
            load: async () => record,
            save: async (next) => {
                record = next;
            },
        },
        localStorage: memoryStorage(),
        ...deps,
    };
    return { deps: all, replaceState, names: () => record?.tracks.map((track) => track.name) };
}

describe('Import of moved data', () => {
    test('an address without move does nothing', async () => {
        const data = await movedData();
        const { deps, replaceState } = page('#m=12/41.7/44.8', { fetch: data.fetch });
        expect(await moveIn(deps)).toBeNull();
        expect(replaceState).not.toHaveBeenCalled();
        expect(data.calls).toHaveLength(0);
    });

    test('the moved tracks come after the own tracks, and move leaves the address', async () => {
        const data = await movedData();
        const { deps, replaceState, names } = page(`#m=12/41.7/44.8&move=${data.move}`, { fetch: data.fetch });
        expect(await moveIn(deps)).toBeNull();
        expect(replaceState).toHaveBeenCalledWith(null, '', '/#m=12/41.7/44.8');
        expect(names()).toEqual(['Made on trailroutine.com', 'Kazbegi loop']);
    });

    test('Moved tracks appear once', async () => {
        const data = await movedData();
        const local = memoryStorage();
        const first = page(`#move=${data.move}`, { fetch: data.fetch, localStorage: local });
        expect(await moveIn(first.deps)).toBeNull();
        expect(first.replaceState).toHaveBeenCalledWith(null, '', '/');
        const second = { ...first.deps, location: { pathname: '/', search: '', hash: `#move=${data.move}` } };
        expect(await moveIn(second)).toBeNull();
        expect(first.names()).toEqual(['Made on trailroutine.com', 'Kazbegi loop']);
        expect(JSON.parse(local.getItem(MOVED_IN_KEY) as string)).toEqual(['k'.repeat(22)]);
        expect(data.calls).toHaveLength(1);
    });

    test('settings from the old address are copied only when the new domain has none', async () => {
        const data = await movedData({ 'nakarte-web:layers': 'moved layers', 'nakarte-web:position': 'moved view' });
        const local = memoryStorage({ 'nakarte-web:position': 'own view' });
        const { deps } = page(`#move=${data.move}`, { fetch: data.fetch, localStorage: local });
        await moveIn(deps);
        expect(local.getItem('nakarte-web:layers')).toBe('moved layers');
        expect(local.getItem('nakarte-web:position')).toBe('own view');
    });

    test('Link from another site', async () => {
        const data = await movedData({ 'nakarte-web:layers': 'custom layer of a stranger' });
        const local = memoryStorage();
        const { deps, names } = page(`#move=${data.move}`, {
            fetch: data.fetch,
            localStorage: local,
            referrer: 'https://example.com/page',
        });
        expect(await moveIn(deps)).toBeNull();
        expect(names()).toContain('Kazbegi loop');
        expect(local.getItem('nakarte-web:layers')).toBeNull();
    });

    test('Import fails', async () => {
        const data = await movedData();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { deps, names } = page(`#move=${'x'.repeat(22)}.${'y'.repeat(43)}`, { fetch: data.fetch });
        expect(await moveIn(deps)).toBe(MOVE_FAILED);
        expect(names()).toEqual(['Made on trailroutine.com']);
        const broken = page('#move=garbage', { fetch: data.fetch });
        expect(await moveIn(broken.deps)).toBe(MOVE_FAILED);
        warn.mockRestore();
    });
});
