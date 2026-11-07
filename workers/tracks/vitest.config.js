import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {defineConfig} from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: {configPath: './wrangler.toml'},
            // the rate limits are lower (all requests 3, writes 2), so a few requests are sufficient to check `429`;
            // `namespace_id` is the field name of miniflare, camelCase is not possible here
            miniflare: {
                ratelimits: {
                    RATE_LIMITER: {namespace_id: '1003', simple: {limit: 3, period: 60}},
                    WRITE_RATE_LIMITER: {namespace_id: '1006', simple: {limit: 2, period: 60}},
                },
            },
        }),
    ],
});
