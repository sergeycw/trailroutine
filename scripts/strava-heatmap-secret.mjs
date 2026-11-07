// Puts the CloudFront cookies and _strava_idcf of a Strava account into the secret STRAVA_COOKIES of the proxy
// nakarte-cors-proxy and checks a heatmap tile through the proxy. Without these cookies CloudFront serves the Strava
// heatmap tiles with 403 (`MissingKey`); the proxy adds the secret only to requests to
// content-*.strava.com/identified/globalheat/ (workers/cors-proxy).
//
// How to get the cookies: log in on strava.com, open https://www.strava.com/maps/global-heatmap, DevTools →
// Network → filter `globalheat` → any tile → Request Headers → Cookie → Copy value. The page itself
// does not see these cookies (they are not in document.cookie), so this is the only way.
//
// Run from the repository root: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-heatmap-secret.mjs
// wrangler 4 requires Node ≥ 22, but the default here is Node 20 from nvm; Node 22 is in /usr/local/bin.
// The cookies live for about one day (on 2026-10-08 the expiry was +24 h), update them daily.
// The script reads the value from stdin, not from the arguments, so that it does not get into the shell history. From
// the header only CloudFront-* and _strava_idcf stay: the Strava session (_strava4_session etc.) does not go to the
// secret.
// _strava_idcf is a JWT with athleteId and the same expiry as the policy: without it a CloudFront function before
// the tiles answers 401 (`x-cache: FunctionGeneratedResponse`), although the signed cookies are correct (2026-10-08).
// --dry-run: only parse and show the names and the expiry, without wrangler and without the check.
import {spawnSync} from 'node:child_process';

const REQUIRED = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature', '_strava_idcf'];
const PROXY = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev';
const ORIGIN = 'https://trailroutine.com';
// tile of Tbilisi z12, it surely has tracks
const TEST_TILE = 'https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256';
const dryRun = process.argv.includes('--dry-run');
const MIN_NODE_MAJOR = 22;

function fail(message) {
    console.error(message);
    process.exit(1);
}

async function readStdin() {
    if (process.stdin.isTTY) {
        fail('pipe the Cookie header into stdin: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-heatmap-secret.mjs');
    }
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

// A Cookie header, a line from DevTools or «name=value» on separate lines: all of them become pairs.
function heatmapCookies(raw) {
    const cookies = new Map();
    for (const part of raw.replace(/^\s*cookie:\s*/iu, '').split(/[;\n]/u)) {
        const eq = part.indexOf('=');
        const name = part.slice(0, eq).trim();
        if (eq > 0 && REQUIRED.includes(name)) {
            cookies.set(name, part.slice(eq + 1).trim());
        }
    }
    return cookies;
}

// CloudFront-Policy is the policy JSON in base64 with the CloudFront replacements: + → -, = → _, / → ~.
// The expiry is Condition.DateLessThan['AWS:EpochTime'] of the first Statement.
function policyExpiry(policy) {
    try {
        const json = Buffer.from(policy.replace(/-/gu, '+').replace(/_/gu, '=').replace(/~/gu, '/'), 'base64');
        const epoch = JSON.parse(json.toString('utf8')).Statement[0].Condition.DateLessThan['AWS:EpochTime'];
        return new Date(epoch * 1000);
    } catch {
        return null;
    }
}

if (!dryRun && Number(process.versions.node.split('.')[0]) < MIN_NODE_MAJOR) {
    fail(
        `wrangler needs Node >= ${MIN_NODE_MAJOR}, this is ${process.versions.node}: ` +
            'pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-heatmap-secret.mjs'
    );
}

const cookies = heatmapCookies(await readStdin());
const missing = REQUIRED.filter((name) => !cookies.get(name));
if (missing.length) {
    fail(`missing cookies: ${missing.join(', ')}; copy the Cookie header of a globalheat tile request`);
}
const expiry = policyExpiry(cookies.get('CloudFront-Policy'));
console.log(`cookies: ${[...cookies.keys()].join(', ')}`);
console.log(`expires: ${expiry ? expiry.toISOString() : 'unknown (policy not parsed)'}`);
if (expiry && expiry < new Date()) {
    fail('these cookies are already expired: open the heatmap again and copy fresh ones');
}
if (dryRun) {
    process.exit(0);
}

const value = REQUIRED.map((name) => `${name}=${cookies.get(name)}`).join('; ');
// wrangler reads the secret value from stdin if stdin is not a terminal
const put = spawnSync('npx', ['--yes', 'wrangler@4', 'secret', 'put', 'STRAVA_COOKIES'], {
    cwd: new URL('../workers/cors-proxy/', import.meta.url),
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
});
if (put.status !== 0) {
    fail('wrangler secret put failed');
}

// The secret does not apply to the new Worker version immediately: several attempts.
for (let attempt = 1; attempt <= 5; attempt++) {
    // a network failure on this machine is not a reason to fail: the secret is already written, try again
    try {
        const response = await fetch(`${PROXY}/${TEST_TILE}&check=${Date.now()}`, {headers: {Origin: ORIGIN}});
        const type = response.headers.get('content-type');
        console.log(`check ${attempt}: ${response.status} ${type}`);
        if (response.ok && type?.startsWith('image/')) {
            console.log('strava heatmap works through the proxy');
            process.exit(0);
        }
    } catch (error) {
        console.log(`check ${attempt}: ${error.cause?.code ?? error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
}
fail('the proxy still gets no tile: check that the cookies are fresh and from a logged-in strava account');
