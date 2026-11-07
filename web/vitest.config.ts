import { readFileSync } from 'node:fs';
import { playwright } from '@vitest/browser-playwright';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// An answer with a given HTTP status for the browser tests of the map: /__status__/404/… → 404. The dev server answers
// 200 text/html on any path that does not exist, but the tests need a real 404 (no tile) and 503 (the server is down).
function statusResponses(): Plugin {
    return {
        name: 'test-status-responses',
        configureServer(server) {
            server.middlewares.use('/__status__/', (req, res) => {
                res.statusCode = Number.parseInt(req.url?.split('/')[1] ?? '', 10) || 500;
                res.end();
            });
        },
    };
}

// A fixture as bytes: `import data from './x.zip?bytes'` gives the base64 of the file (src/test/bytes.ts decodes it).
// ?raw breaks binary files (it reads them as UTF-8), and Vite serves ?inline only for known asset types, not for
// .gpx/.plt/.kmz.
function fixtureBytes(): Plugin {
    return {
        name: 'test-fixture-bytes',
        enforce: 'pre',
        load(id) {
            if (!id.endsWith('?bytes')) {
                return null;
            }
            const base64 = readFileSync(id.slice(0, -'?bytes'.length)).toString('base64');
            return `export default ${JSON.stringify(base64)};`;
        },
    };
}

// Two parts: unit in Node (*.test.ts), and the tests that need a browser in Chromium (*.browser.test.ts[x]).
// The tests do not go to the network: the tiles are a fixture from src/test/.
export default mergeConfig(
    viteConfig,
    defineConfig({
        plugins: [fixtureBytes()],
        test: {
            projects: [
                {
                    extends: true,
                    test: {
                        name: 'unit',
                        environment: 'node',
                        include: ['src/**/*.test.ts', 'vite/**/*.test.ts'],
                        exclude: [...configDefaults.exclude, '**/*.browser.test.*'],
                        // the browser DOMParser for the track parsers (design add-web-tracks, «Парсеры»)
                        setupFiles: ['src/test/node-dom.ts'],
                    },
                },
                {
                    extends: true,
                    plugins: [statusResponses()],
                    // dependencies that Vite else finds only during the run and then reloads the test
                    // («Vite unexpectedly reloaded a test»): a second copy of React fails with useContext of null.
                    // With a cold cache (CI) the first file that imports them fails this way.
                    optimizeDeps: {
                        include: [
                            '@base-ui/react/checkbox',
                            '@base-ui/react/dialog',
                            '@base-ui/react/menu',
                            '@base-ui/react/popover',
                            '@base-ui/react/radio',
                            '@base-ui/react/radio-group',
                            '@sentry/react',
                            'blueimp-md5',
                            'fflate',
                            'lucide-react',
                            'maplibre-contour',
                            'pbf',
                            'zustand',
                            'zustand/vanilla',
                        ],
                    },
                    test: {
                        name: 'browser',
                        include: ['src/**/*.browser.test.{ts,tsx}'],
                        browser: {
                            enabled: true,
                            provider: playwright(),
                            headless: true,
                            instances: [{ browser: 'chromium' }],
                        },
                    },
                },
            ],
        },
    }),
);
