import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { config } from '@/config';
import { P } from '@/test/map-events';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { saveNktk } from '@/tracks/nktk';

// The feedback form in App (spec feedback): the feedback service and the track storage are a fetch stub, the test
// reads the posted forms. The test titles are the scenarios of the spec.

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'запросы мимо localhost и тайлов').toEqual([]);
});

interface Service {
    fetch: typeof fetch;
    forms: FormData[];
    stored: string[];
}

function service(status = 204): Service {
    const forms: FormData[] = [];
    const stored: string[] = [];
    return {
        forms,
        stored,
        fetch: async (input, init) => {
            const url = String(input);
            if (url === config.feedbackUrl) {
                forms.push(init?.body as FormData);
                return new Response(null, { status });
            }
            if (url.startsWith(`${config.tracksStorageServer}/track/`)) {
                stored.push(url);
                return new Response(null, { status: 200 });
            }
            throw new TypeError(`no network in tests: ${url}`);
        },
    };
}

const WALK = saveNktk({ name: 'Walk', segments: [[P(41.68, 44.78), P(41.689, 44.781), P(41.69, 44.79)]], points: [] });

async function render(api: Service, hash = '#m=14/41.69/44.785&l=O') {
    return renderApp(tiles, hash, { fetch: api.fetch, tracksOpen: false });
}

const dialog = () => page.getByRole('dialog');

async function fill(email: string, message: string) {
    await page.getByRole('button', { name: 'Send feedback' }).click();
    await expect.element(dialog()).toBeVisible();
    await dialog().getByLabelText('Your email').fill(email);
    await dialog().getByLabelText('Message').fill(message);
}

describe('Feedback form', () => {
    test('Send feedback', async () => {
        const api = service();
        await render(api, `#m=14/41.69/44.785&l=O&nktk=${WALK}`);
        await fill('anna@example.com', 'The route goes over the fence.');
        const file = new File(['png bytes'], 'route.png', { type: 'image/png' });
        await userEvent.upload(dialog().getByLabelText('Files'), file);
        await expect.element(dialog().getByTestId('feedback-file').getByText('route.png')).toBeVisible();
        await expect.element(dialog().getByRole('checkbox', { name: 'Attach my tracks (1)' })).toBeChecked();
        await dialog().getByRole('button', { name: 'Send' }).click();
        await expect.element(page.getByText('Thanks! We will reply to anna@example.com.')).toBeVisible();
        await expect.element(dialog()).not.toBeInTheDocument();
        expect(api.stored).toHaveLength(1);
        expect(api.forms).toHaveLength(1);
        const [form] = api.forms;
        expect(form.get('email')).toBe('anna@example.com');
        expect(form.get('message')).toBe('The route goes over the fence.');
        const context = String(form.get('context'));
        expect(context).toMatch(/^Page: http.*#.*m=14\/41\.69/u);
        expect(context).toMatch(/\nTracks \(1\): http.*#.*nktl=[A-Za-z0-9_-]{22}/u);
        expect(context).toContain(`Browser: ${navigator.userAgent}`);
        expect((form.getAll('file') as File[]).map((item) => item.name)).toEqual(['route.png']);
    });

    test('Email is required', async () => {
        const api = service();
        await render(api);
        await fill('', 'Hello');
        await dialog().getByRole('button', { name: 'Send' }).click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(api.forms).toEqual([]);
        await expect.element(dialog()).toBeVisible();
    });

    test('Without tracks', async () => {
        const api = service();
        await render(api, `#m=14/41.69/44.785&l=O&nktk=${WALK}`);
        await fill('anna@example.com', 'No tracks, please.');
        await dialog().getByRole('checkbox', { name: 'Attach my tracks (1)' }).click();
        await dialog().getByRole('button', { name: 'Send' }).click();
        await expect.poll(() => api.forms.length).toBe(1);
        expect(String(api.forms[0].get('context'))).not.toContain('Tracks');
        expect(api.stored).toEqual([]);
    });

    test('Files over the limit', async () => {
        const api = service();
        await render(api);
        await fill('anna@example.com', 'A big file');
        const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'video.mp4', { type: 'video/mp4' });
        await userEvent.upload(dialog().getByLabelText('Files'), big);
        await expect
            .element(dialog().getByRole('alert'))
            .toHaveTextContent('Too many files: up to 10 files and 10 MB in all.');
        await expect.element(dialog().getByRole('button', { name: 'Send' })).toBeDisabled();
        await dialog().getByRole('button', { name: 'Remove video.mp4' }).click();
        await expect.element(dialog().getByRole('button', { name: 'Send' })).toBeEnabled();
    });

    test('Service error', async () => {
        const api = service(502);
        await render(api);
        await fill('anna@example.com', 'Keep this text');
        await dialog().getByRole('button', { name: 'Send' }).click();
        await expect
            .element(dialog().getByRole('alert'))
            .toHaveTextContent('Could not send the message. Check the connection and try again.');
        await expect.element(dialog().getByLabelText('Message')).toHaveValue('Keep this text');
    });
});
