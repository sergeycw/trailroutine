import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';

// BRouter engine files for the dev server and vite preview. In production the Pages Functions of the same
// origin serve them (functions/brouter-wasm, functions/tiles), locally this middleware and the /tiles proxy to
// nakarte-tiles-worker (vite.config.ts) serve them. CheerpJ reads /app/ only with Range requests and without 206 with
// Content-Range does not see the file size (AGENTS.md, «Движок в браузере (CheerpJ)»), so the Vite static files
// (outside root and without a Range guarantee) are not suitable. The layout is as in functions/brouter-wasm and
// functions/tiles in production.

const REPO = fileURLToPath(new URL('../../', import.meta.url));

// [URL prefix, directory]. experiments/wasm/cheerpj/build.sh puts lib and profiles, scripts/brouter-segments.sh puts
// the tiles for the mode without clone (config.routingTilesPath = /brouter-wasm/segments4/).
export type Mounts = Array<[prefix: string, dir: string]>;

const DEFAULT_MOUNTS: Mounts = [
    ['/brouter-wasm/lib/', path.join(REPO, 'experiments/wasm/cheerpj/lib')],
    ['/brouter-wasm/profiles/', path.join(REPO, 'experiments/wasm/cheerpj/profiles')],
    ['/brouter-wasm/segments4/', path.join(REPO, 'brouter/segments4')],
];

// What goes into the build: the engine code and profiles. In production functions/brouter-wasm serves them with Range
// from the Pages static files, and functions/tiles serves the tiles from R2, so segments4 does not go into the build.
const BUILD_MOUNTS: Mounts = DEFAULT_MOUNTS.filter(([prefix]) => prefix !== '/brouter-wasm/segments4/');

// Copies the engine directories into the build (<outDir>/brouter-wasm/lib, …), as CopyWebpackPlugin of the old client
// did. Returns the missing directories: without experiments/wasm/cheerpj/build.sh the build passes without the engine
// (check-web.yml), and the deploy catches this with its own check of the files in build/.
export function copyEngineFiles(outDir: string, mounts: Mounts = BUILD_MOUNTS): string[] {
    const missing: string[] = [];
    for (const [prefix, dir] of mounts) {
        if (!existsSync(dir)) {
            missing.push(dir);
            continue;
        }
        cpSync(dir, path.join(outDir, prefix), { recursive: true });
    }
    return missing;
}

// BRouter reads storageconfig.txt from the tile directory; functions/tiles serves it empty, as the old dev server did.
const EMPTY_FILES = new Set(['/brouter-wasm/segments4/storageconfig.txt']);

const RANGE = /^bytes=(\d*)-(\d*)$/;

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

// The same parsing as in functions/brouter-wasm: one range, the suffix `bytes=-N`, the end is clipped to the size.
export function parseRange(header: string | undefined, size: number): ByteRange {
    const match = RANGE.exec(header ?? '');
    if (!match || (match[1] === '' && match[2] === '')) {
        return null;
    }
    const [, from, to] = match;
    const range =
        from === ''
            ? { start: Math.max(size - Number(to), 0), end: size - 1 }
            : { start: Number(from), end: to === '' ? size - 1 : Math.min(Number(to), size - 1) };
    return range.start > range.end ? 'unsatisfiable' : range;
}

export function resolveEngineFile(url: string, mounts: Mounts): string | null {
    const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
    for (const [prefix, dir] of mounts) {
        if (!pathname.startsWith(prefix)) {
            continue;
        }
        const file = path.resolve(dir, pathname.slice(prefix.length));
        return file.startsWith(dir + path.sep) ? file : null;
    }
    return null;
}

export const engineFilesMiddleware =
    (mounts: Mounts = DEFAULT_MOUNTS): Connect.NextHandleFunction =>
    (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/brouter-wasm/')) {
            next();
            return;
        }
        res.setHeader('Accept-Ranges', 'bytes');
        if (EMPTY_FILES.has(new URL(url, 'http://localhost').pathname)) {
            res.setHeader('Content-Length', '0');
            res.end();
            return;
        }
        const file = resolveEngineFile(url, mounts);
        const stat = file ? statSync(file, { throwIfNoEntry: false }) : undefined;
        if (!file || !stat?.isFile()) {
            res.statusCode = 404;
            res.end();
            return;
        }
        const range = parseRange(req.headers.range, stat.size);
        if (range === 'unsatisfiable') {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            res.end();
            return;
        }
        if (!range) {
            res.setHeader('Content-Length', String(stat.size));
            req.method === 'HEAD' ? res.end() : createReadStream(file).pipe(res);
            return;
        }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
        res.setHeader('Content-Length', String(range.end - range.start + 1));
        req.method === 'HEAD' ? res.end() : createReadStream(file, range).pipe(res);
    };

export function engineFiles(): Plugin {
    const middleware = engineFilesMiddleware();
    return {
        name: 'trailroutine-engine-files',
        // middleware before the internal Vite ones: the Vite static server does not serve Range or files outside the
        // project root
        configureServer: (server) => {
            server.middlewares.use(middleware);
        },
        configurePreviewServer: (server) => {
            server.middlewares.use(middleware);
        },
        writeBundle(options) {
            const missing = copyEngineFiles(options.dir ?? path.join(REPO, 'build'));
            if (missing.length) {
                this.warn(
                    `engine files are not in the build, run experiments/wasm/cheerpj/build.sh: ${missing.join(', ')}`,
                );
            }
        },
    };
}
