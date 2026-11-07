import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, localStorageOrNull } from './App';
import { indexedDbStorage } from './autosave/idb';
import { legacySessionSource } from './autosave/legacy-session';
import { config } from './config';
import { rootErrorHandler, startErrorTracking, stopReportingOnLeave } from './errors/tracking';
import { moveIn } from './move/move-in';
import { moveOut } from './move/move-out';
import './index.css';

// The tracker starts before the render: the startup errors (empty map, WebGL) are the most important
// (design add-error-tracking)
startErrorTracking(config.sentryDsn);
const onError = rootErrorHandler();

// The move to trailroutine.com runs before the render (change move-to-trailroutine-domain, design «Before the app
// starts»): the old address leaves without rendering, the new domain writes the moved tracks before the autosave
// restore reads them. On any other host and without `move` in the address both return at once, with no storage access.
async function start() {
    const local = localStorageOrNull();
    const fetch = window.fetch.bind(window);
    const storage = indexedDbStorage();
    const target = await moveOut({
        location: window.location,
        config,
        storage: { ...storage, legacy: legacySessionSource() },
        localStorage: local,
        fetch,
    });
    if (target) {
        stopReportingOnLeave();
        window.location.replace(target);
        return;
    }
    const notice = await moveIn({
        location: window.location,
        history: window.history,
        referrer: document.referrer,
        config,
        storage,
        localStorage: local,
        fetch,
    });
    createRoot(document.getElementById('root') as HTMLElement, {
        onUncaughtError: onError,
        onRecoverableError: onError,
    }).render(
        <StrictMode>
            <App notice={notice} />
        </StrictMode>,
    );
}

void start();
