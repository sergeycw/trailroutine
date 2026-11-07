import type { ErrorEvent } from '@sentry/react';
import { describe, expect, test } from 'vitest';
import oldLinks from '../state/fixtures/old-links.txt?raw';
import { keepBreadcrumb, scrubEvent } from './scrub';

// Spec clone-monitoring, «Отчёт без места и треков пользователя». The links are real old links of nakarte.me with a
// map view and tracks (the fixture of hash.test.ts) and links of the new app with the same parameters.

const PAGE = 'https://nakarte-routing.pages.dev/';
const links = [
    ...oldLinks.split('\n').filter((line) => line.startsWith('https://')),
    `${PAGE}#m=13/43.27/42.49&l=Tt&nktk=Cg5OZXcgdHJhY2sSBggBEgIIAQ`,
    `${PAGE}?r=43.27,42.49#m=13/43.27/42.49&nktl=KYOMJFo4WrootHEbXrMSTA`,
];

function eventFrom(url: string): ErrorEvent {
    return {
        type: undefined,
        request: { url, headers: { 'User-Agent': 'Chrome', Referer: url }, query_string: 'r=43.27,42.49' },
        exception: {
            values: [
                {
                    type: 'TypeError',
                    value: `fetch failed: https://nakarte-elevation.nakarte-routing.workers.dev/?43.27,42.49 at ${url}`,
                    stacktrace: { frames: [{ filename: url, abs_path: url }, { filename: `${PAGE}assets/index.js` }] },
                },
            ],
        },
    };
}

describe('Отчёт без места и треков пользователя', () => {
    test('Ошибка на ссылке с треком', () => {
        expect(links.length).toBeGreaterThan(10);
        for (const url of links) {
            const event = scrubEvent(eventFrom(url));
            const text = JSON.stringify(event);
            expect(text, url).not.toMatch(/[#?]|43\.27|42\.49|nktk|nktl|m=/);
            expect(event.request?.url).toBe(`${new URL(url).origin}/`);
            expect(event.request?.headers).toEqual({ 'User-Agent': 'Chrome' });
            // the script path stays: Sentry finds the source map by it
            expect(event.exception?.values?.[0].stacktrace?.frames?.[1].filename).toBe(`${PAGE}assets/index.js`);
            expect(event.exception?.values?.[0].value).toBe(
                `fetch failed: https://nakarte-elevation.nakarte-routing.workers.dev at ${new URL(url).origin}`,
            );
        }
    });

    test('хлебные крошки: только клики и ввод', () => {
        for (const category of ['fetch', 'xhr', 'navigation', 'console', undefined]) {
            expect(keepBreadcrumb({ category, data: { url: `${PAGE}#m=13/43.27/42.49` } }), category).toBeNull();
        }
    });

    test('селектор клика без подписей элементов', () => {
        // the track menu button in the list: aria-label and title contain the track name, and the SDK writes them
        // to the selector
        const node = (tagName: string, attributes: Record<string, string>, parentElement: unknown = null) => ({
            tagName,
            parentElement,
            getAttribute: (name: string) => attributes[name] ?? null,
        });
        const list = node('DIV', { 'data-testid': 'track-list' });
        const button = node('BUTTON', { 'aria-label': 'Actions for Kazbek', title: 'Kazbek' }, list);
        const sdkMessage = 'div > button[aria-label="Actions for Kazbek"][title="Kazbek"]';
        for (const category of ['ui.click', 'ui.input']) {
            const kept = keepBreadcrumb({ category, message: sdkMessage }, { event: { target: button } });
            expect(kept?.message).toBe('div[data-testid="track-list"] > button');
        }
        // no target, so no selector
        expect(keepBreadcrumb({ category: 'ui.click', message: sdkMessage })?.message).toBeUndefined();
    });

    test('брошенный не-Error не уходит целиком', () => {
        const event = eventFrom(PAGE);
        event.extra = { __serialized__: { track: 'Kazbek', lat: 43.27 } };
        expect(scrubEvent(event).extra).toBeUndefined();
    });
});
