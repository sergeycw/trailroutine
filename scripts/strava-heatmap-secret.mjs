// Кладёт куки CloudFront и _strava_idcf аккаунта Strava в секрет STRAVA_COOKIES прокси nakarte-cors-proxy и проверяет
// тайл heatmap через прокси. Без этих кук CloudFront отдаёт тайлы Strava heatmap с 403 (`MissingKey`);
// прокси подставляет секрет только в запросы content-*.strava.com/identified/globalheat/ (workers/cors-proxy).
//
// Как взять куки: войти на strava.com, открыть https://www.strava.com/maps/global-heatmap, DevTools →
// Network → фильтр `globalheat` → любой тайл → Request Headers → Cookie → Copy value. Страница сама
// эти куки не видит (их нет в document.cookie), поэтому только так.
//
// Запуск из корня репозитория: pbpaste | PATH=/usr/local/bin:$PATH node scripts/strava-heatmap-secret.mjs
// wrangler 4 требует Node ≥ 22, а по умолчанию здесь nvm-шный Node 20; Node 22 лежит в /usr/local/bin.
// Куки живут около суток (2026-10-08 срок был +24 ч), обновлять ежедневно.
// Значение читается из stdin, а не из аргументов, чтобы не попасть в историю shell. Из заголовка
// остаются только CloudFront-* и _strava_idcf: сессия Strava (_strava4_session и т. п.) в секрет не уходит.
// _strava_idcf — JWT с athleteId и тем же сроком, что у политики: без него функция CloudFront перед
// тайлами отвечает 401 (`x-cache: FunctionGeneratedResponse`), хотя подписанные куки верны (2026-10-08).
// --dry-run: только разобрать и показать имена и срок, без wrangler и проверки.
import {spawnSync} from 'node:child_process';

const REQUIRED = ['CloudFront-Key-Pair-Id', 'CloudFront-Policy', 'CloudFront-Signature', '_strava_idcf'];
const PROXY = 'https://nakarte-cors-proxy.nakarte-routing.workers.dev';
const ORIGIN = 'https://trailroutine.com';
// тайл Тбилиси z12, на нём точно есть треки
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

// Заголовок Cookie, строка из DevTools или «имя=значение» по строкам — всё сводится к парам.
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

// CloudFront-Policy — JSON политики в base64 с заменами CloudFront: + → -, = → _, / → ~.
// Срок — Condition.DateLessThan['AWS:EpochTime'] первого Statement.
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
// wrangler читает значение секрета из stdin, если он не терминал
const put = spawnSync('npx', ['--yes', 'wrangler@4', 'secret', 'put', 'STRAVA_COOKIES'], {
    cwd: new URL('../workers/cors-proxy/', import.meta.url),
    input: value,
    stdio: ['pipe', 'inherit', 'inherit'],
});
if (put.status !== 0) {
    fail('wrangler secret put failed');
}

// Секрет применяется к новой версии Worker'а не мгновенно: несколько попыток.
for (let attempt = 1; attempt <= 5; attempt++) {
    // сбой сети на этой машине — не повод падать: секрет уже записан, пробуем ещё раз
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
