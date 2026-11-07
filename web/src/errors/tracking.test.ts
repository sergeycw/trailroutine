import { beforeEach, describe, expect, test, vi } from 'vitest';

// The tracker start without the network: the SDK is replaced. The tests check the options that go to Sentry.init,
// and that without a DSN the code does not touch the SDK at all: without Sentry.init the SDK has no client and no
// transport, so it cannot send. e2e checks the send and the scrub of a real envelope (e2e/clone-monitoring.spec.ts,
// the Sentry intake stub).
const capture = vi.hoisted(() => vi.fn());
const sentry = vi.hoisted(() => ({
    init: vi.fn(),
    captureException: vi.fn(),
    reactErrorHandler: vi.fn(() => capture),
}));
vi.mock('@sentry/react', () => sentry);

const DSN = 'https://public@o0.ingest.sentry.io/0';
const ORIGIN = 'https://nakarte-routing.pages.dev';

// the module has its own state (whether the tracker runs, which backends it already reported): each test starts
// from a clean import
async function load() {
    vi.resetModules();
    return import('./tracking');
}

async function started() {
    const tracking = await load();
    tracking.startErrorTracking(DSN, ORIGIN);
    return { tracking, options: sentry.init.mock.calls[0][0] };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('Запросы к Sentry только с ошибкой', () => {
    test('Сборка без DSN', async () => {
        const tracking = await load();
        expect(tracking.startErrorTracking('', ORIGIN)).toBe(false);
        tracking.reportEngineBackendError('worker', new Error('worker failed'));
        expect(tracking.rootErrorHandler()).toBeUndefined();
        expect(sentry.init).not.toHaveBeenCalled();
        expect(sentry.captureException).not.toHaveBeenCalled();
    });

    test('Заход без ошибок', async () => {
        const { options } = await started();
        // the session on each visit is off, and so is the client report about discarded events: no requests
        // without an error
        const defaults = ['BrowserSession', 'GlobalHandlers', 'CultureContext', 'Breadcrumbs'].map((name) => ({
            name,
        }));
        expect(options.integrations(defaults).map((i: { name: string }) => i.name)).toEqual([
            'GlobalHandlers',
            'Breadcrumbs',
        ]);
        expect(options.sendClientReports).toBe(false);
        expect(options.dsn).toBe(DSN);
        expect(options.allowUrls).toEqual([ORIGIN]);
    });
});

describe('Отчёт без места и треков пользователя', () => {
    test('сбор пользователя, кук, заголовков и тел выключен, очистка стоит', async () => {
        const { options } = await started();
        expect(options.dataCollection).toMatchObject({
            userInfo: false,
            cookies: false,
            httpHeaders: { request: { allow: ['user-agent'] }, response: false },
            httpBodies: [],
            urlQueryParams: false,
        });
        // the SDK does not touch the fetch messages in the app (toasts)
        expect(options.enhanceFetchErrorMessages).toBe('report-only');
        const { keepBreadcrumb, scrubEvent } = await import('./scrub');
        const event = { request: { url: 'https://trailroutine.com/#m=12/41.7/44.8&nktk=abc' } };
        expect(options.beforeSend(structuredClone(event))).toEqual(scrubEvent(structuredClone(event) as never));
        expect(options.beforeBreadcrumb).toBe(keepBreadcrumb);
    });
});

describe('No reports after the page leaves', () => {
    test('No reports after the page leaves', async () => {
        const { tracking, options } = await started();
        const event = { message: 'Importing a module script failed.' };
        expect(options.beforeSend(structuredClone(event))).not.toBeNull();
        // the move to the new domain, a reload or a navigation begins: Safari and Firefox abort the loads in flight
        tracking.stopReportingOnLeave();
        expect(options.beforeSend(structuredClone(event))).toBeNull();
    });
});

describe('Ошибки в браузере пользователей', () => {
    test('Движок не запустился: отказ бэкенда — один отчёт за загрузку страницы', async () => {
        const { tracking } = await started();
        tracking.reportEngineBackendError('worker', new Error('worker failed'));
        tracking.reportEngineBackendError('worker', new Error('worker failed again'));
        // a Java exception from CheerpJ is not an Error
        tracking.reportEngineBackendError('main-thread', { javaClass: 'java.lang.ArithmeticException' });
        expect(sentry.captureException.mock.calls).toEqual([
            [
                new Error('BRouter engine worker failed to start: worker failed'),
                { tags: { 'engine.backend': 'worker' } },
            ],
            [
                new Error('BRouter engine main-thread failed to start: [object Object]'),
                { tags: { 'engine.backend': 'main-thread' } },
            ],
        ]);
    });

    test('ошибка рендера уходит как необработанная и остаётся в консоли', async () => {
        const { tracking } = await started();
        const console = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {});
        const handler = tracking.rootErrorHandler();
        const error = new Error('render failed');
        handler?.(error, { componentStack: '\n    at App' });
        // without a callback: with a callback the SDK would mark the error as handled
        expect(sentry.reactErrorHandler).toHaveBeenCalledWith();
        expect(capture).toHaveBeenCalledWith(error, { componentStack: '\n    at App' });
        expect(console).toHaveBeenCalledWith(error);
        console.mockRestore();
    });
});
