import * as Sentry from '@sentry/react';
import { keepBreadcrumb, scrubEvent } from './scrub';

// The error tracker in the browser of the user is Sentry (spec clone-monitoring, «Ошибки в браузере пользователей»
// and «Запросы к Sentry только с ошибкой»; design add-error-tracking). Only the project address (DSN) from the
// production build turns it on: without the DSN, the code does not call Sentry.init, and there are no handlers and
// no requests (dev server, tests, forks).

const DROPPED_INTEGRATIONS = new Set(['BrowserSession', 'CultureContext']);

let started = false;
// the engine backends with a failure report that is already sent: the engine restarts on each route request, and
// otherwise one broken browser would use up the monthly limit with repeated reports
const reportedBackends = new Set<string>();

// origin is a parameter for the unit tests in Node, which have no location
export function startErrorTracking(dsn: string, origin = window.location.origin): boolean {
    if (!dsn) {
        return false;
    }
    Sentry.init({
        dsn,
        environment: 'production',
        // BrowserSession sends a session on each visit, also without an error; CultureContext is the time zone, that
        // is, the region
        integrations: (defaults) => defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name)),
        // the client report about discarded events (errors of extensions outside allowUrls) goes when the tab hides:
        // a request without an error of ours (review of the diff)
        sendClientReports: false,
        // 'always' adds the host to error.message of each failed fetch, and the app shows these messages in toasts
        enhanceFetchErrorMessages: 'report-only',
        // only our own scripts: errors of extensions and third-party scripts (Google Maps, CheerpJ from the CDN) do
        // not use the limit. The SDK lets through a report without an address in the frames (eventFilters,
        // _isAllowedUrl)
        allowUrls: [origin],
        // in v11 the SDK collects each category that is not specified: user (IP), cookies, headers, request bodies
        // (MIGRATION.md 11.x, «sendDefaultPii is replaced by dataCollection»). Each one is turned off explicitly
        dataCollection: {
            userInfo: false,
            cookies: false,
            // User-Agent gives the browser and the OS of the report; the SDK replaces the other headers with
            // [Filtered], and scrubEvent deletes them
            httpHeaders: { request: { allow: ['user-agent'] }, response: false },
            httpBodies: [],
            urlQueryParams: false,
            graphQL: { document: false, variables: false },
            genAI: { inputs: false, outputs: false },
            mcp: { inputs: false, outputs: false },
            databaseQueryData: false,
            queues: false,
        },
        beforeSend: scrubEvent,
        beforeBreadcrumb: keepBreadcrumb,
    });
    started = true;
    return true;
}

// A failure of one engine backend (worker or main thread) goes as a separate report, not more than one time per page
// load. A routing failure does not come here: it is an answer of the router, not an error (spec, «Маршрута нет»)
export function reportEngineBackendError(backend: string, error: unknown): void {
    if (!started || reportedBackends.has(backend)) {
        return;
    }
    reportedBackends.add(backend);
    // our own error, not the original one: the CheerpJ code from the CDN creates the original, and allowUrls would
    // discard the report by its last frame; a Java exception is not an Error at all (review of the diff). The message
    // contains the text of the original
    const text = error instanceof Error ? error.message : String(error);
    Sentry.captureException(new Error(`BRouter engine ${backend} failed to start: ${text}`), {
        tags: { 'engine.backend': backend },
    });
}

// The render error handler for createRoot: with the component stack. Without the tracker it is undefined, and React
// works as before (reportError to the console)
export function rootErrorHandler(): ((error: unknown, errorInfo: { componentStack?: string }) => void) | undefined {
    if (!started) {
        return undefined;
    }
    // without a callback: with a callback the SDK marks the error as handled, but a failed render removes all of the
    // app. With a custom onUncaughtError, React does not write to the console any more, so the code prints the error
    // itself to keep it visible with the tracker on
    const capture = Sentry.reactErrorHandler();
    return (error, errorInfo) => {
        capture(error, errorInfo);
        console.error(error);
    };
}
