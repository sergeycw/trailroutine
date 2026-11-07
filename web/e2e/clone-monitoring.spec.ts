import { readdirSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { ELEVATION_SERVER, expect, openTracks, test } from './fixtures.ts';

// Error tracker on the clone build (spec clone-monitoring, design add-error-tracking): a stub of the fixture network
// replaces the Sentry intake, the envelopes are in network.sentryEnvelopes. The scenarios run only if the build has a
// DSN: in CI the fake one from check-web.yml or the real deploy secret; a local `npm run build` without a DSN skips
// them.

const ASSETS = new URL('../../build/assets/', import.meta.url);
const DSN_IN_BUNDLE = /https:\/\/\w+@o\d+\.ingest\.(?:[a-z]+\.)?sentry\.io\/\d+/;
const buildHasDsn = readdirSync(ASSETS)
    .filter((file) => file.endsWith('.js'))
    .some((file) => DSN_IN_BUNDLE.test(readFileSync(new URL(file, ASSETS), 'utf8')));

// saveNktk({name: 'Mtatsminda', …}): the same track as in elevation-profile.spec.ts
const TBILISI = 'RAoCEAESNgoKTXRhdHNtaW5kYRIQCgbele0B0gMSBorn_gHzAhoWCICZ7QEQluT-ARoKGghUViB0b3dlcg==';
const LINK = `./#m=15/41.692/44.788&nktk=${TBILISI}`;

// event from an envelope: the envelope header line, the item header line, the body; takes the item with type: event
function eventOf(envelope: string) {
    const lines = envelope.split('\n');
    const index = lines.findIndex((line) => line.includes('"type":"event"'));
    return JSON.parse(lines[index + 1]);
}

async function openProfile(page: Page) {
    await openTracks(page);
    await page.getByRole('button', { name: 'Actions for Mtatsminda' }).click();
    await page.getByRole('menuitem', { name: 'Show elevation profile', exact: true }).click();
    await expect(page.getByTestId('elevation-profile').locator('[data-stat="distance"]')).toHaveText(/km$/);
}

test.describe('Ошибки в браузере пользователей', () => {
    test.skip(!buildHasDsn, 'сборка без VITE_SENTRY_DSN: трекер выключен');

    test('Ошибка на ссылке с треком', async ({ page, network }) => {
        await page.goto(LINK);
        await openProfile(page);
        expect(network.elevationRequests).toHaveLength(1);
        // inline script: its stack frame has the full page address, with #m=… and the track
        await page.addScriptTag({
            content: "setTimeout(() => { throw new Error('e2e crash at ' + location.href); }, 0);",
        });
        await expect.poll(() => network.sentryEnvelopes.length).toBe(1);
        const event = eventOf(network.takeSentryEnvelopes()[0]);
        const origin = new URL(page.url()).origin;
        expect(event.request.url).toBe(`${origin}/`);
        expect(event.exception.values[0].value).toBe(`e2e crash at ${origin}`);
        const text = JSON.stringify(event);
        // Mtatsminda is the track name: the button «Actions for Mtatsminda» gets into the click breadcrumb
        const leaks = [
            '41.692',
            '44.788',
            'm=15',
            'Mtatsminda',
            TBILISI.slice(0, 20),
            new URL(ELEVATION_SERVER).hostname,
        ];
        expect(event.breadcrumbs?.length, 'клики по меню трека есть в крошках').toBeGreaterThan(0);
        for (const leak of leaks) {
            expect(text, leak).not.toContain(leak);
        }
        for (const breadcrumb of event.breadcrumbs ?? []) {
            expect(['ui.click', 'ui.input']).toContain(breadcrumb.category);
        }
        expect(event.user?.ip_address).toBeUndefined();
    });

    // the other e2e check the same at the end of each test (fixture network); here with a hidden tab: then the SDK
    // would send the client report and the session if they were on. The SDK drops the ResizeObserver error by default
    // (DEFAULT_IGNORE_ERRORS), but a client report that is on would report it when the tab becomes hidden
    test('Заход без ошибок', async ({ page, network }) => {
        await page.goto(LINK);
        await openProfile(page);
        await page.addScriptTag({
            content:
                "setTimeout(() => { throw new Error('ResizeObserver loop completed with undelivered notifications.'); }, 0);",
        });
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await page.waitForTimeout(1500);
        expect(network.sentryEnvelopes).toEqual([]);
    });
});
