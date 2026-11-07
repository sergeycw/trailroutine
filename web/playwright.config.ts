import { defineConfig, devices } from '@playwright/test';

// e2e against the built app (vite preview serves build/ from the root, as Pages does in production).
// Build before the run: npm run build && npm run e2e. The tests do not go to the network — e2e/fixtures.ts.
const BASE_URL = 'http://localhost:4173/';

export default defineConfig({
    testDir: 'e2e',
    forbidOnly: !!process.env.CI,
    reporter: process.env.CI ? 'github' : 'list',
    use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: { command: 'npx vite preview', url: BASE_URL, reuseExistingServer: !process.env.CI },
});
