import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseRedirects, resolveRedirect } from './redirects.ts';

const rules = parseRedirects(readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8'));

// Spec web-client, «Старый адрес /next/»
describe('public/_redirects', () => {
    test.each([
        ['/next', '/'],
        ['/next/', '/'],
        ['/next/engine-bench.html', '/engine-bench.html'],
        ['/next/assets/index.js', '/assets/index.js'],
    ])('%s → %s', (pathname, location) => {
        expect(resolveRedirect(rules, pathname)).toEqual({ location, status: 302 });
    });

    test.each(['/', '/engine-bench.html', '/nextpage', '/tiles/E40_N40.rd5', '/brouter-wasm/lib/brouter.jar'])(
        '%s без редиректа',
        (pathname) => {
            expect(resolveRedirect(rules, pathname)).toBeNull();
        },
    );
});
