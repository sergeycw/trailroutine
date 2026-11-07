import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {readFileSync, readdirSync} from 'node:fs';
import {defineConfig} from 'vitest/config';

// There is no file system in workerd: the thinned objects `fixtures/dem3/*` and the reference answers
// go to the test as bindings (objects in base64), and the test puts them into the local R2 `DEM`.
const fixturesDir = new URL('./fixtures/', import.meta.url);
const demObjects = Object.fromEntries(
    readdirSync(new URL('dem3/', fixturesDir)).map((name) => [
        `dem3/${name}`,
        readFileSync(new URL(`dem3/${name}`, fixturesDir)).toString('base64'),
    ])
);

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.toml'},
            miniflare: {
                bindings: {
                    FIXTURE_OBJECTS: demObjects,
                    FIXTURE_REFERENCE: readFileSync(new URL('reference.txt', fixturesDir), 'utf8'),
                },
                // the rate limits are lower, so a few requests are sufficient to check `429`;
                // `namespace_id` is the field name of miniflare, camelCase is not possible here
                ratelimits: {
                    API_RATE_LIMITER: {namespace_id: '1002', simple: {limit: 2, period: 60}},
                    // 5 units of 64 reads: a request for 200 reads (4 units) passes one time
                    API_READS_RATE_LIMITER: {namespace_id: '1005', simple: {limit: 5, period: 60}},
                },
            },
        }),
    ],
});
