// Puts the Strava session into the secret STRAVA_SESSION of the proxy nakarte-cors-proxy. With it the proxy gets
// the CloudFront cookies and _strava_idcf for the heatmap tiles itself (workers/cors-proxy/src/strava.js), so
// the daily scripts/strava-heatmap-secret.mjs is not necessary while the session is alive.
//
// How to get the header: log in on strava.com, open https://www.strava.com/maps/global-heatmap, DevTools →
// Network → request `global-heatmap` (type document; or any request to www.strava.com) → Request Headers →
// Cookie → Copy value.
//
// Run from the repository root: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-session-secret.mjs
// wrangler 4 requires Node ≥ 22, but the default here is Node 20 from nvm; Node 22 is in /usr/local/bin.
//
// Order: from the header only the session cookies (SESSION_COOKIES) stay, the script makes the same request as the
// proxy with them locally, and prints the names of the received cookies and the expiry, before it writes the secret.
// If no cookies come with them, the script tries the whole header and tells if this helps: then Strava needs more
// session cookies, and you must add their names to SESSION_COOKIES. The script prints no values anywhere and reads
// them from stdin, so that they do not get into the shell history.
// --dry-run: only the parsing and the local check, without wrangler and without the check through the proxy.
// --probe: writes nothing, finds a «remember me» cookie. On 2026-10-08 the proxy log showed that the heatmap
// page does not extend _strava4_session, so a secret with the session alone dies together with the session. If
// Strava issues a new session for a different, long-lived cookie, the search finds the minimal set of cookies with
// which heatmap works without _strava4_session, and prints only the names; put these names into SESSION_COOKIES.
// --rotation: writes nothing, finds a page that extends the session. With _strava4_session alone it
// opens ROTATION_PAGES (only GET) and prints the status, the names and expiries of the answer cookies, and if the
// value of _strava4_session changed (a comparison, without output). If a page issues a new session, the proxy
// can go there itself and keep the session in KV; if not, the Strava server sets the session expiry.
import {spawnSync} from 'node:child_process';

import {HEATMAP_COOKIES, describeSetCookie, fetchHeatmapCookies} from '../workers/cors-proxy/src/strava.js';

// checked by the owner on 2026-10-08: the heatmap page needs only _strava4_session
const SESSION_COOKIES = ['_strava4_session'];
const PROXY = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev';
const ORIGIN = 'https://trailroutine.com';
// tile of Tbilisi z12, it surely has tracks
const TEST_TILE = 'https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256';
const MIN_NODE_MAJOR = 22;
const dryRun = process.argv.includes('--dry-run');
const probeMode = process.argv.includes('--probe');
const rotationMode = process.argv.includes('--rotation');
// Only reads. Do not touch /api/next/session/update: the frontend writes the session data through it (PUT).
const ROTATION_PAGES = [
    'https://www.strava.com/dashboard',
    'https://www.strava.com/api/next/session/get?keys=flash_notice',
    'https://www.strava.com/frontend/athlete/notifications/num_new_notifications',
    'https://www.strava.com/maps/global-heatmap',
];
const ROTATION_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// pause between the requests of the search: ten page loads in a row must not look like a bot
const PROBE_DELAY_MS = 1000;

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function readStdin() {
    if (process.stdin.isTTY) {
        fail(
            'pipe the Cookie header into stdin: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-session-secret.mjs'
        );
    }
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

// A Cookie header, a line from DevTools or «name=value» on separate lines: all of them become pairs.
function parseCookies(raw) {
    const cookies = new Map();
    for (const part of raw.replace(/^\s*cookie:\s*/iu, '').split(/[;\n]/u)) {
        const eq = part.indexOf('=');
        const name = part.slice(0, eq).trim();
        if (eq > 0) {
            cookies.set(name, part.slice(eq + 1).trim());
        }
    }
    return cookies;
}

function cookieHeader(cookies, names) {
    return names.map((name) => `${name}=${cookies.get(name)}`).join('; ');
}

// The same request that the proxy makes; prints only the names and the expiry.
async function tryRefresh(label, header) {
    try {
        const {expiresAt, setCookies} = await fetchHeatmapCookies(header);
        // names and expiries of all the answer cookies: is there an extended _strava4_session
        console.log(`${label}: set-cookie ${setCookies.join('; ')}`);
        console.log(`${label}: got ${HEATMAP_COOKIES.join(', ')}`);
        console.log(
            `${label}: expires ${expiresAt ? new Date(expiresAt).toISOString() : 'unknown (policy not parsed)'}`
        );
        return true;
    } catch (error) {
        console.log(`${label}: ${error.cause?.code ?? error.message}`);
        return false;
    }
}

async function heatmapWorks(cookies, names) {
    await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS));
    try {
        await fetchHeatmapCookies(cookieHeader(cookies, names));
        return true;
    } catch {
        return false;
    }
}

// Greedy search: remove one cookie at a time while heatmap still works without it.
async function probe(cookies) {
    const others = [...cookies.keys()].filter((name) => name !== '_strava4_session');
    console.log(`header cookies: ${[...cookies.keys()].join(', ')}`);
    if (!(await tryRefresh('without _strava4_session', cookieHeader(cookies, others)))) {
        console.log('no other cookie logs strava in: the session cannot renew itself, it lives until it expires');
        return;
    }
    let needed = others;
    for (const name of others) {
        const rest = needed.filter((other) => other !== name);
        if (await heatmapWorks(cookies, rest)) {
            needed = rest;
        }
    }
    console.log(`minimal set without _strava4_session: ${needed.join(', ')}`);
    // set-cookie of this answer shows if Strava issues a new _strava4_session for them, and with which expiry
    await tryRefresh('minimal set', cookieHeader(cookies, needed));
}

// Value of _strava4_session from the Set-Cookie of the answer, only for the comparison with the sent value.
function sessionFromSetCookie(response) {
    for (const line of response.headers.getSetCookie()) {
        const match = /^\s*_strava4_session=([^;]*)/u.exec(line);
        if (match) {
            return match[1];
        }
    }
    return null;
}

async function rotation(cookies) {
    const sent = cookies.get('_strava4_session');
    if (!sent) {
        fail('missing cookies: _strava4_session; copy the Cookie header of a www.strava.com request while logged in');
    }
    for (const page of ROTATION_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, PROBE_DELAY_MS));
        const path = new URL(page).pathname;
        try {
            const response = await fetch(page, {
                headers: {'cookie': `_strava4_session=${sent}`, 'user-agent': ROTATION_USER_AGENT},
                redirect: 'manual',
                signal: AbortSignal.timeout(10_000),
            });
            await response.body?.cancel();
            const location = response.headers.get('location');
            const received = sessionFromSetCookie(response);
            const session = received === null ? 'not set' : received === sent ? 'same value' : 'NEW VALUE';
            const setCookies = response.headers.getSetCookie().map(describeSetCookie);
            console.log(`${path}: ${response.status}${location ? ` to ${new URL(location, page).pathname}` : ''}`);
            console.log(`  _strava4_session: ${session}`);
            console.log(`  set-cookie: ${setCookies.join('; ') || 'none'}`);
        } catch (error) {
            console.log(`${path}: ${error.cause?.code ?? error.message}`);
        }
    }
}

if (!dryRun && !probeMode && !rotationMode && Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
    fail(
        `wrangler needs Node >= ${MIN_NODE_MAJOR}, this is ${process.versions.node}: ` +
            'pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-session-secret.mjs'
    );
}

const cookies = parseCookies(await readStdin());
if (probeMode) {
    await probe(cookies);
    process.exit(0);
}
if (rotationMode) {
    await rotation(cookies);
    process.exit(0);
}
const missing = SESSION_COOKIES.filter((name) => !cookies.get(name));
if (missing.length) {
    fail(`missing cookies: ${missing.join(', ')}; copy the Cookie header of a www.strava.com request while logged in`);
}
const session = cookieHeader(cookies, SESSION_COOKIES);
console.log(`session cookies: ${SESSION_COOKIES.join(', ')}`);

if (!(await tryRefresh('local check', session))) {
    const all = [...cookies.keys()];
    if (await tryRefresh('local check with the whole header', cookieHeader(cookies, all))) {
        fail(
            `strava needs more session cookies than ${SESSION_COOKIES.join(', ')}; ` +
                `the header has: ${all.join(', ')}. Add the needed names to SESSION_COOKIES in this script`
        );
    }
    fail('strava gives no heatmap cookies for this session: log in on strava.com again and copy a fresh header');
}
if (dryRun) {
    process.exit(0);
}

// wrangler reads the secret value from stdin if stdin is not a terminal
const put = spawnSync('npx', ['--yes', 'wrangler@4', 'secret', 'put', 'STRAVA_SESSION'], {
    cwd: new URL('../workers/cors-proxy/', import.meta.url),
    input: session,
    stdio: ['pipe', 'inherit', 'inherit'],
});
if (put.status !== 0) {
    fail('wrangler secret put failed');
}

// The secret does not apply to the new Worker version immediately: several attempts. The fallback STRAVA_COOKIES
// also gives a tile with 200, so success is only with X-Strava-Cookies: session.
for (let attempt = 1; attempt <= 6; attempt++) {
    // a network failure on this machine is not a reason to fail: the secret is already written, try again
    try {
        const response = await fetch(`${PROXY}/${TEST_TILE}&check=${Date.now()}`, {headers: {Origin: ORIGIN}});
        const type = response.headers.get('content-type');
        const source = response.headers.get('x-strava-cookies');
        console.log(`check ${attempt}: ${response.status} ${type}, cookies from ${source}`);
        if (response.ok && type?.startsWith('image/') && source === 'session') {
            console.log('strava heatmap works through the proxy with the session');
            process.exit(0);
        }
    } catch (error) {
        console.log(`check ${attempt}: ${error.cause?.code ?? error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
}
fail(
    'the proxy does not use the session yet: `npx wrangler@4 tail` in workers/cors-proxy shows ' +
        '"strava heatmap cookies not refreshed: <reason>"'
);
