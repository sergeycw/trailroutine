import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { engineFiles } from './vite/engine-files.ts';

// The app is at the root of the Pages project nakarte-routing (design switch-to-web-app): the build is all of build/,
// the plugin engineFiles adds the engine files there; /next/ of old links answers with a redirect from
// public/_redirects.
export default defineConfig({
    base: '/',
    plugins: [react(), tailwindcss(), engineFiles()],
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
        outDir: '../build',
        // Vite does not clean a directory outside the project root without the flag
        emptyOutDir: true,
        // source maps for the stack in Sentry: next to the files, but without the sourceMappingURL link in the bundle.
        // The deploy uploads them to Sentry and deletes them before the publication (design add-error-tracking,
        // «Карты исходников»)
        sourcemap: 'hidden',
        // maplibre-gl ≈ 1.1 MB (≈ 290 KB gzip) as a separate chunk: react-maplibre loads it with a dynamic import()
        chunkSizeWarningLimit: 1200,
        // the licenses of the bundle dependencies in one file /licenses.md: BSD-3 (MapLibre, maplibre-contour) requires
        // the copyright and the license text for distribution in built form, and the minifier drops the license
        // comments (design add-contour-lines, «Risks / Trade-offs»). A name in the root, not the default
        // .vite/license.md, gives a short address in production
        license: { fileName: 'licenses.md' },
        // the engine bench deploys next to the app (/engine-bench.html) for checks in production
        // (design spike-engine-in-worker); no links go to it, the CheerpJ runtime loads only when you open it
        rolldownOptions: {
            input: {
                index: fileURLToPath(new URL('./index.html', import.meta.url)),
                bench: fileURLToPath(new URL('./engine-bench.html', import.meta.url)),
            },
        },
    },
    // 8767–8768 — the engine bench experiments/wasm/serve.mjs, 8787–8789 — the Workers
    // /tiles/ (BRouter tiles in the clone mode) — nakarte-tiles-worker;
    // the plugin engineFiles serves /brouter-wasm/
    server: { port: 8769, strictPort: true, proxy: { '/tiles/': 'http://localhost:8788' } },
    preview: { port: 4173, strictPort: true },
});
