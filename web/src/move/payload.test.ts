import { describe, expect, test } from 'vitest';
import { MOVED_TRACK } from './fixture';
import { MOVED_SETTINGS, MoveError, openPayload, readSettings, sealPayload } from './payload';

describe('move payload', () => {
    test('a round trip keeps the tracks exactly and the settings as text', async () => {
        const settings = { 'nakarte-web:layers': '{"selection":"Of"}', leaflet_locate_position: '[42,44]' };
        const { body, secret } = await sealPayload({ tracks: [MOVED_TRACK], settings });
        // the track storage takes only these characters (LINK_BODY in workers/tracks/src/index.js)
        expect(body).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
        expect(body).not.toContain('Kazbegi');
        const payload = await openPayload(body, secret);
        expect(payload.tracks).toHaveLength(1);
        expect(payload.tracks[0].segments[0]).toEqual(MOVED_TRACK.segments[0]);
        expect(payload.tracks[0].segments[0][0]).toBe(42.657000000000004);
        expect(payload.tracks[0]).toMatchObject({ name: 'Kazbegi loop', color: 3, points: MOVED_TRACK.points });
        expect(payload.settings).toEqual(settings);
    });

    test('a wrong key or damaged text is a MoveError', async () => {
        const { body, secret } = await sealPayload({ tracks: [MOVED_TRACK], settings: {} });
        const other = await sealPayload({ tracks: [], settings: {} });
        await expect(openPayload(body, other.secret)).rejects.toBeInstanceOf(MoveError);
        await expect(openPayload(body.slice(0, -4), secret)).rejects.toBeInstanceOf(MoveError);
        await expect(openPayload('not base64url!', secret)).rejects.toBeInstanceOf(MoveError);
    });

    test('broken tracks and unknown settings do not move', async () => {
        const broken = { ...MOVED_TRACK, segments: [new Float64Array([42.6, 44.6])], points: [] };
        const { body, secret } = await sealPayload({
            tracks: [MOVED_TRACK, broken],
            settings: { 'nakarte-web:position': '{}', 'other-site:key': 'x' },
        });
        const payload = await openPayload(body, secret);
        expect(payload.tracks.map((track) => track.name)).toEqual(['Kazbegi loop']);
        expect(payload.settings).toEqual({ 'nakarte-web:position': '{}' });
    });

    test('settings are read only from the allowlist', () => {
        const values = new Map<string, string>([
            ['nakarte-web:layers', 'L'],
            ['trackListRoutingActivity', 'A'],
            ['unrelated', 'U'],
        ]);
        expect(readSettings({ getItem: (key) => values.get(key) ?? null })).toEqual({
            'nakarte-web:layers': 'L',
            trackListRoutingActivity: 'A',
        });
        expect(readSettings(null)).toEqual({});
        expect(MOVED_SETTINGS).toContain('nakarte-web:recent-colors');
    });
});
