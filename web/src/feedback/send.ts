import type { Track } from '@/tracks/model';
import { shareBody, shareLink, storeTracks } from '@/tracks/share';

// Feedback without React (change add-feedback, spec feedback): the context of the page and the POST of the form to
// the feedback service (workers/feedback). The service sends the email; the app knows only this address.

// The same limits as workers/feedback/src/index.js: the form shows the error before the upload
export const MAX_FILES_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;

export interface FeedbackForm {
    email: string;
    message: string;
    files: readonly File[];
    // the tracks of the list for the link in the email; null: the user turned the tracks off
    tracks: readonly Track[] | null;
}

export interface FeedbackEnv {
    fetch: typeof fetch;
    feedbackUrl: string;
    tracksStorageServer: string;
    location: { origin: string; pathname: string; hash: string };
    userAgent: string;
    screen: string;
}

export type FeedbackResult = 'sent' | 'too-big' | 'rate-limited' | 'failed';

export function filesBytes(files: readonly File[]): number {
    return files.reduce((sum, file) => sum + file.size, 0);
}

// The lines under the message in the email: the page (the view and the layers are in the address), the tracks, the
// browser. The tracks are a short nktl link, as «Copy link for all tracks»: the owner opens it in the app with the
// route markup. A failed link does not stop the message.
export async function feedbackContext(env: FeedbackEnv, tracks: readonly Track[] | null): Promise<string> {
    const { origin, pathname, hash } = env.location;
    const lines = [`Page: ${origin}${pathname}${hash}`];
    if (tracks && tracks.length > 0) {
        try {
            const key = await storeTracks(shareBody(tracks), {
                fetch: env.fetch,
                tracksStorageServer: env.tracksStorageServer,
            });
            lines.push(`Tracks (${tracks.length}): ${shareLink(env.location, key)}`);
        } catch (error) {
            lines.push(`Tracks (${tracks.length}): no link, ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    lines.push(`Browser: ${env.userAgent}`, `Screen: ${env.screen}`);
    return lines.join('\n');
}

export async function sendFeedback(form: FeedbackForm, env: FeedbackEnv): Promise<FeedbackResult> {
    if (form.files.length > MAX_FILES || filesBytes(form.files) > MAX_FILES_BYTES) {
        return 'too-big';
    }
    const body = new FormData();
    body.set('email', form.email.trim());
    body.set('message', form.message.trim());
    body.set('context', await feedbackContext(env, form.tracks));
    for (const file of form.files) {
        body.append('file', file);
    }
    let response: Response;
    try {
        response = await env.fetch(env.feedbackUrl, { method: 'POST', body });
    } catch {
        return 'failed';
    }
    if (response.ok) {
        return 'sent';
    }
    if (response.status === 413) {
        return 'too-big';
    }
    if (response.status === 429) {
        return 'rate-limited';
    }
    return 'failed';
}
