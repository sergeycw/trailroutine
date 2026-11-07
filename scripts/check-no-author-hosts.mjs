// Finds the hosts of the author infrastructure (nakarte.me and subdomains) in the built bundle and fails on any literal
// match. Run: node scripts/check-no-author-hosts.mjs [build]. Steps of the deploy (.github/workflows/deploy-pages.yml)
// and check-web.yml; decision — openspec/changes/archive/*-drop-author-services/design.md. The exceptions for metadata
// strings of the old client (<title>, GPX creator, JNX file name, text of the sessions notice) went away with it
// (design switch-to-web-app): the bundle of the app has no such strings.
import {readdir, readFile} from 'node:fs/promises';
import {extname, join, relative} from 'node:path';

const ROOT = process.argv[2] ?? 'build';
// Text files that the browser loads. The browser does not request the source maps (.map), and they contain
// the comments of the sources; the jar and the tiles are binary.
const TEXT_EXTENSIONS = new Set(['.js', '.html', '.css', '.json', '.txt', '.webmanifest', '.svg']);
// Literal host: the link parsing regular expressions in the bundle are escaped (nakarte\.me) and do not match here.
const AUTHOR_HOST = /(?:[a-z0-9-]+\.)*nakarte\.me/giu;
const CONTEXT_CHARS = 60;

async function* walk(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walk(path);
        } else if (TEXT_EXTENSIONS.has(extname(entry.name))) {
            yield path;
        }
    }
}

function findAuthorHosts(text) {
    const found = [];
    for (const match of text.matchAll(AUTHOR_HOST)) {
        const start = match.index;
        const end = start + match[0].length;
        const context = text
            .slice(Math.max(0, start - CONTEXT_CHARS), end + CONTEXT_CHARS)
            .replace(/\s+/gu, ' ');
        found.push({host: match[0], offset: start, context});
    }
    return found;
}

let total = 0;
let files = 0;
for await (const path of walk(ROOT)) {
    files += 1;
    for (const {host, offset, context} of findAuthorHosts(await readFile(path, 'utf8'))) {
        total += 1;
        console.log(`${relative(process.cwd(), path)}:${offset}: ${host}\n    …${context}…`);
    }
}

if (files === 0) {
    console.error(`no text files in ${ROOT}: build first`);
    process.exit(2);
}
if (total > 0) {
    console.error(`\n${total} author host reference(s) in ${files} files`);
    process.exit(1);
}
console.log(`no author hosts in ${files} files of ${ROOT}`);
