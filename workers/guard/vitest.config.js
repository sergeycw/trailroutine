import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.toml'},
            // the limit is lower, so a few requests are sufficient to check `429`;
            // `namespace_id` is the field name of miniflare, camelCase is not possible here
            miniflare: {ratelimits: {RATE_LIMITER: {namespace_id: '1008', simple: {limit: 3, period: 60}}}},
        }),
    ],
});
