import type { Breadcrumb, BreadcrumbHint, ErrorEvent } from '@sentry/react';

// The scrub of a Sentry report before the send (spec clone-monitoring, «Отчёт без места и треков пользователя»;
// design add-error-tracking, «Что уходит и что вырезается»). The user location is in the page address (m=, r=, the
// tracks nktk, nktl and the other parameters of src/state/sync.ts are in the fragment #…), in the request addresses
// (coordinates of the elevation API and BRouter, tile numbers) and in the text of messages with such addresses. Pure
// functions without the SDK: the unit tests run them in Node.

// the address without the parameters and the fragment; for text that is not an address, an empty string, not the
// original text
function withoutParams(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.origin + parsed.pathname;
    } catch {
        return '';
    }
}

// each address in the text becomes only its origin: the path of a third-party address also contains the location
// (z/x/y of a tile, E40_N40.rd5 of BRouter)
const URL_IN_TEXT = /https?:\/\/[^\s"'<>()]+/g;

function originsOnly(text: string): string {
    return text.replace(URL_IN_TEXT, (url) => {
        try {
            return new URL(url).origin;
        } catch {
            return '';
        }
    });
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
    const { request } = event;
    if (request) {
        if (request.url) {
            request.url = withoutParams(request.url);
        }
        // User-Agent stays: Sentry finds the browser and the OS from it; Referer is the third-party page from which
        // the user came
        const userAgent = request.headers?.['User-Agent'];
        request.headers = userAgent ? { 'User-Agent': userAgent } : undefined;
        delete request.query_string;
        delete request.cookies;
        delete request.data;
    }
    // extra: the SDK puts a thrown non-Error value here in full (__serialized__), and it can contain anything
    delete event.extra;
    if (event.message) {
        event.message = originsOnly(event.message);
    }
    for (const exception of event.exception?.values ?? []) {
        if (exception.value) {
            exception.value = originsOnly(exception.value);
        }
        // the frames of an inline script and of eval contain the full page address, together with #…; the source maps
        // need the script path, so the frames keep the origin and the path
        for (const frame of exception.stacktrace?.frames ?? []) {
            if (frame.filename) {
                frame.filename = withoutParams(frame.filename) || frame.filename;
            }
            if (frame.abs_path) {
                frame.abs_path = withoutParams(frame.abs_path) || frame.abs_path;
            }
        }
    }
    return event;
}

// Only clicks and input stay. The code discards requests (fetch, xhr), navigation (an address with #…) and console
// in full: a list of allowed categories is more reliable than to cut out the location part by part.
const KEPT_BREADCRUMBS = new Set(['ui.click', 'ui.input']);
// ancestors in the selector: enough to find the panel with data-testid
const SELECTOR_DEPTH = 5;

// the part of a DOM element that the selector reads: the Node unit tests have no Element, so the element is a
// plain object
interface SelectorNode {
    tagName: string;
    parentElement: SelectorNode | null;
    getAttribute(name: string): string | null;
}

function isSelectorNode(target: unknown): target is SelectorNode {
    return typeof target === 'object' && target !== null && 'tagName' in target && 'getAttribute' in target;
}

// The selector of the SDK (htmlTreeAsString in @sentry/browser-utils) always adds the values of aria-label, title,
// name and alt, and in our app these contain track names («Actions for <track>», the title of a track) and a
// placemark with coordinates (review of the diff of add-error-tracking). So the code builds the selector again from
// the tag and data-testid: the code writes them, not the user
function safeSelector(target: SelectorNode): string {
    const parts: string[] = [];
    for (let node: SelectorNode | null = target; node && parts.length < SELECTOR_DEPTH; node = node.parentElement) {
        const testId = node.getAttribute('data-testid');
        parts.unshift(node.tagName.toLowerCase() + (testId ? `[data-testid="${testId}"]` : ''));
    }
    return parts.join(' > ');
}

export function keepBreadcrumb(breadcrumb: Breadcrumb, hint?: BreadcrumbHint): Breadcrumb | null {
    if (!breadcrumb.category || !KEPT_BREADCRUMBS.has(breadcrumb.category)) {
        return null;
    }
    const target: unknown = hint?.event?.target;
    return { ...breadcrumb, message: isSelectorNode(target) ? safeSelector(target) : undefined, data: undefined };
}
