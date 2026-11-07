// Кладёт сессию Strava в секрет STRAVA_SESSION прокси nakarte-cors-proxy. По ней прокси сам получает
// куки CloudFront и _strava_idcf для тайлов heatmap (workers/cors-proxy/src/strava.js), так что
// ежедневный scripts/strava-heatmap-secret.mjs больше не нужен, пока жива сессия.
//
// Как взять заголовок: войти на strava.com, открыть https://www.strava.com/maps/global-heatmap, DevTools →
// Network → запрос `global-heatmap` (тип document; или любой запрос к www.strava.com) → Request Headers →
// Cookie → Copy value.
//
// Запуск из корня репозитория: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-session-secret.mjs
// wrangler 4 требует Node ≥ 22, а по умолчанию здесь nvm-шный Node 20; Node 22 лежит в /usr/local/bin.
//
// Порядок: из заголовка остаются только куки сессии (SESSION_COOKIES), с ними локально делается тот же
// запрос, что у прокси, и печатаются имена полученных кук и срок — до записи секрета. Если с ними куки не
// пришли, скрипт пробует весь заголовок и говорит, помогло ли: значит, Strava нужно больше кук сессии,
// и их имена надо добавить в SESSION_COOKIES. Значения нигде не печатаются, читаются из stdin, чтобы
// не попасть в историю shell.
// --dry-run: только разбор и локальная проверка, без wrangler и проверки через прокси.
// --probe: ничего не записывает, ищет куку «запомнить меня». 2026-10-08 журнал прокси показал, что страница
// heatmap не продлевает _strava4_session, значит, секрет с одной сессией умрёт вместе с ней. Если Strava
// выдаёт новую сессию по другой, долгоживущей куке, перебор найдёт минимальный набор кук, с которым
// heatmap работает без _strava4_session, и напечатает только имена; их и надо класть в SESSION_COOKIES.
// --rotation: ничего не записывает, ищет страницу, которая продлевает сессию. С одной _strava4_session
// открывает ROTATION_PAGES (только GET) и печатает статус, имена и сроки кук ответа и то, сменилось ли
// значение _strava4_session (сравнение, без вывода). Если какая-то страница выдаёт новую сессию, прокси
// может сам ходить туда и хранить её в KV; если нет — срок сессии задаёт сервер Strava.
import {spawnSync} from 'node:child_process';

import {HEATMAP_COOKIES, describeSetCookie, fetchHeatmapCookies} from '../workers/cors-proxy/src/strava.js';

// 2026-10-08 проверено владельцем: странице heatmap хватает одной _strava4_session
const SESSION_COOKIES = ['_strava4_session'];
const PROXY = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev';
const ORIGIN = 'https://trailroutine.com';
// тайл Тбилиси z12, на нём точно есть треки
const TEST_TILE = 'https/content-a.strava.com/identified/globalheat/all/hot/12/2557/1514.png?px=256';
const MIN_NODE_MAJOR = 22;
const dryRun = process.argv.includes('--dry-run');
const probeMode = process.argv.includes('--probe');
const rotationMode = process.argv.includes('--rotation');
// Только чтение. /api/next/session/update не трогаем: фронтенд пишет через него данные сессии (PUT).
const ROTATION_PAGES = [
    'https://www.strava.com/dashboard',
    'https://www.strava.com/api/next/session/get?keys=flash_notice',
    'https://www.strava.com/frontend/athlete/notifications/num_new_notifications',
    'https://www.strava.com/maps/global-heatmap',
];
const ROTATION_USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// пауза между запросами перебора: десяток загрузок страницы подряд не должен выглядеть как бот
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

// Заголовок Cookie, строка из DevTools или «имя=значение» по строкам — всё сводится к парам.
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

// Тот же запрос, что делает прокси; печатает только имена и срок.
async function tryRefresh(label, header) {
    try {
        const {expiresAt, setCookies} = await fetchHeatmapCookies(header);
        // имена и сроки всех кук ответа: есть ли там продлённая _strava4_session
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

// Жадный перебор: убираем по одной куке, пока без неё heatmap ещё работает.
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
    // set-cookie этого ответа покажет, выдаёт ли Strava по ним новую _strava4_session и с каким сроком
    await tryRefresh('minimal set', cookieHeader(cookies, needed));
}

// Значение _strava4_session из Set-Cookie ответа, только для сравнения с отправленным.
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

// wrangler читает значение секрета из stdin, если он не терминал
const put = spawnSync('npx', ['--yes', 'wrangler@4', 'secret', 'put', 'STRAVA_SESSION'], {
    cwd: new URL('../workers/cors-proxy/', import.meta.url),
    input: session,
    stdio: ['pipe', 'inherit', 'inherit'],
});
if (put.status !== 0) {
    fail('wrangler secret put failed');
}

// Секрет применяется к новой версии Worker'а не мгновенно: несколько попыток. Тайл 200 даёт и запасной
// STRAVA_COOKIES, поэтому успех — только с X-Strava-Cookies: session.
for (let attempt = 1; attempt <= 6; attempt++) {
    // сбой сети на этой машине — не повод падать: секрет уже записан, пробуем ещё раз
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
