import {cloudflareTest} from '@cloudflare/vitest-pool-workers';
import {defineConfig} from 'vitest/config';

// The tests call the fetch handler with their own env (test/feedback.test.js): a fake EMAIL binding keeps the sent
// messages, so no test sends a real email. The pool still checks that wrangler.toml loads.
export default defineConfig({
    plugins: [cloudflareTest({wrangler: {configPath: './wrangler.toml'}})],
});
