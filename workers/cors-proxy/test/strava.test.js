// The refresh of the Strava heatmap cookies by the session in workerd. The page www.strava.com is the stub
// `outboundService` from vitest.config.js: the value of `_strava4_session` sets the behavior
// (ok, redirect, login, offsite, anon, partial, noexpiry, error), the session tail separates the cache of the tests.
import {exports as workerExports} from 'cloudflare:workers';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {RETRY_PAUSE_MS, fetchHeatmapCookies, heatmapCookie, policyExpiry} from '../src/strava.js';

// vitest.config.js has the same number
const POLICY_EXPIRY_MS = 2_000_000_000 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const FALLBACK = 'CloudFront-Key-Pair-Id=k; CloudFront-Policy=p; CloudFront-Signature=s; _strava_idcf=j';

let sessionCounter = 0;
function session(mode) {
    sessionCounter += 1;
    return `_strava4_session=${mode}-${sessionCounter}`;
}

function env(stravaSession, stravaCookies = FALLBACK) {
    return {STRAVA_SESSION: stravaSession, STRAVA_COOKIES: stravaCookies};
}

async function calls(stravaSession) {
    const value = stravaSession.split('=')[1];
    return (await fetch(`https://stub.test/calls?session=${encodeURIComponent(value)}`)).json();
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('fetchHeatmapCookies', () => {
    it('collects the four cookies from Set-Cookie and the policy expiry', async () => {
        const s = session('ok');
        const {cookie, expiresAt} = await fetchHeatmapCookies(s);
        const value = s.split('=')[1];
        expect(cookie).toBe(
            `CloudFront-Key-Pair-Id=kp; CloudFront-Policy=${cookie.split('CloudFront-Policy=')[1].split(';')[0]}; ` +
                `CloudFront-Signature=sig-${value}; _strava_idcf=jwt-${value}`
        );
        expect(cookie).not.toContain('_strava4_session');
        expect(cookie).not.toContain('_strava_CloudFront-Expires');
        expect(expiresAt).toBe(POLICY_EXPIRY_MS);
    });

    it('describes every Set-Cookie by name and lifetime, without values', async () => {
        const s = session('ok');
        const {setCookies} = await fetchHeatmapCookies(s);
        expect(setCookies).toEqual([
            '_strava4_session (Expires=Fri, 08 Oct 2027 00:00:00 GMT)',
            '_strava_CloudFront-Expires',
            'CloudFront-Policy',
            'CloudFront-Signature',
            'CloudFront-Key-Pair-Id',
            '_strava_idcf',
        ]);
        expect(setCookies.join(' ')).not.toContain(s.split('=')[1]);
        await expect(fetchHeatmapCookies(session('partial'))).rejects.toMatchObject({
            setCookies: expect.arrayContaining(['CloudFront-Policy']),
        });
    });

    it('follows redirects inside www.strava.com', async () => {
        const s = session('redirect');
        expect((await fetchHeatmapCookies(s)).cookie).toContain('CloudFront-Signature=sig-');
        expect((await calls(s)).strava).toBe(2);
    });

    it('rejects a redirect to login, off strava.com, an error status and missing cookies', async () => {
        await expect(fetchHeatmapCookies(session('login'))).rejects.toThrow('strava session rejected: 302 to /login');
        await expect(fetchHeatmapCookies(session('offsite'))).rejects.toThrow('redirects off https://www.strava.com');
        expect((await calls(session('none'))).offsite).toBe(0);
        await expect(fetchHeatmapCookies(session('error'))).rejects.toThrow('strava page answered 503');
        await expect(fetchHeatmapCookies(session('anon'))).rejects.toThrow(
            'strava page set no heatmap cookies: 200, session not logged in'
        );
        await expect(fetchHeatmapCookies(session('partial'))).rejects.toThrow(
            'strava page set no CloudFront-Key-Pair-Id, _strava_idcf'
        );
    });

    it('gives no expiry for an unreadable policy', async () => {
        expect((await fetchHeatmapCookies(session('noexpiry'))).expiresAt).toBeNull();
        expect(policyExpiry('not-a-policy')).toBeNull();
    });
});

describe('heatmapCookie', () => {
    const now = POLICY_EXPIRY_MS - 20 * HOUR;

    it('falls back to STRAVA_COOKIES or nothing without a session', async () => {
        expect(await heatmapCookie({STRAVA_COOKIES: FALLBACK}, null, now)).toEqual({
            cookie: FALLBACK,
            source: 'fallback',
        });
        expect(await heatmapCookie({}, null, now)).toEqual({cookie: null, source: 'none'});
    });

    it('refreshes once and reuses cookies until the expiry margin', async () => {
        const s = session('ok');
        const first = await heatmapCookie(env(s), null, now);
        expect(first.source).toBe('session');
        expect(first.cookie).toContain('_strava_idcf=jwt-ok-');
        expect(await heatmapCookie(env(s), null, now + 19 * HOUR)).toEqual(first);
        expect((await calls(s)).strava).toBe(1);

        // from 30 minutes before the policy expiry, a new refresh occurs
        expect(await heatmapCookie(env(s), null, POLICY_EXPIRY_MS - 20 * MINUTE)).toEqual(first);
        expect((await calls(s)).strava).toBe(2);
    });

    it('runs one refresh for parallel tiles and keeps it alive with waitUntil', async () => {
        const s = session('ok');
        const waited = [];
        const ctx = {waitUntil: (promise) => waited.push(promise)};
        const cookies = await Promise.all(Array.from({length: 5}, () => heatmapCookie(env(s), ctx, now)));
        expect(new Set(cookies.map(({cookie}) => cookie)).size).toBe(1);
        expect(cookies[0].cookie).toContain('CloudFront-Signature=');
        expect(waited).toHaveLength(1);
        expect((await calls(s)).strava).toBe(1);
    });

    it('falls back and pauses after a rejected session, logging no values', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const s = session('login');
        expect((await heatmapCookie(env(s), null, now)).cookie).toBe(FALLBACK);
        expect((await heatmapCookie(env(s), null, now + RETRY_PAUSE_MS - MINUTE)).cookie).toBe(FALLBACK);
        expect((await calls(s)).strava).toBe(1);

        expect(await heatmapCookie(env(s, ''), null, now + RETRY_PAUSE_MS + MINUTE)).toEqual({
            cookie: null,
            source: 'none',
        });
        expect((await calls(s)).strava).toBe(2);

        expect(errors).toHaveBeenCalledWith(
            'strava heatmap cookies not refreshed: strava session rejected: 302 to /login'
        );
        for (const [message] of errors.mock.calls) {
            expect(message).not.toContain(s.split('=')[1]);
        }
    });

    it('logs only missing cookie names when Strava sets too few', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const s = session('partial');
        expect(await heatmapCookie(env(s), null, now)).toEqual({cookie: FALLBACK, source: 'fallback'});
        const [[message]] = errors.mock.calls;
        expect(message).toBe(
            'strava heatmap cookies not refreshed: strava page set no CloudFront-Key-Pair-Id, _strava_idcf'
        );
    });

    it('refreshes again in an hour when the policy has no readable expiry', async () => {
        const s = session('noexpiry');
        await heatmapCookie(env(s), null, now);
        await heatmapCookie(env(s), null, now + HOUR - MINUTE);
        expect((await calls(s)).strava).toBe(1);
        await heatmapCookie(env(s), null, now + HOUR + MINUTE);
        expect((await calls(s)).strava).toBe(2);
    });
});

describe('proxy with STRAVA_SESSION', () => {
    // in vitest.config.js, STRAVA_SESSION is `_strava4_session=ok-worker`
    function request(path) {
        return workerExports.default.fetch(`https://proxy.test${path}`, {
            headers: {Origin: 'https://nakarte-routing.pages.dev', Cookie: 'client=1'},
        });
    }

    it('sends refreshed cookies, not the session, to the tile and no cookies to the client', async () => {
        const response = await request(
            '/https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256'
        );
        expect(response.headers.get('Set-Cookie')).toBeNull();
        expect(response.headers.get('X-Strava-Cookies')).toBe('session');
        for (const [, value] of response.headers) {
            expect(value).not.toContain('ok-worker');
        }
        const sent = (await response.json()).headers.cookie;
        expect(sent).toContain('CloudFront-Signature=sig-ok-worker');
        expect(sent).toContain('_strava_idcf=jwt-ok-worker');
        expect(sent).not.toContain('_strava4_session');
        expect(sent).not.toContain('client=1');
    });

    it('sends neither the session nor heatmap cookies anywhere else', async () => {
        for (const path of [
            '/https/www.strava.com/activities/1/streams',
            '/https/example.com/identified/globalheat/x',
        ]) {
            const response = await request(path);
            expect(response.headers.get('X-Strava-Cookies')).toBeNull();
            expect((await response.json()).headers.cookie).toBeUndefined();
        }
    });
});
