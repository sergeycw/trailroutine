import {describe, expect, test} from 'vitest';
import worker, {MAX_FILES, MAX_FILES_BYTES} from '../src/index.js';

// The feedback service (spec feedback): the handler runs with its own env. EMAIL keeps the messages instead of
// sending them, RATE_LIMITER answers as the binding of [[ratelimits]] with a fixed result.

const ORIGIN = 'https://trailroutine.com';

function environment({limited = false, failure = null, to = 'owner@example.com'} = {}) {
    const sent = [];
    return {
        sent,
        env: {
            ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8769`,
            FEEDBACK_FROM: 'feedback@trailroutine.com',
            FEEDBACK_TO: to,
            EMAIL: {
                async send(message) {
                    if (failure) {
                        throw Object.assign(new Error(failure), {code: 'E_DELIVERY_FAILED'});
                    }
                    sent.push(message);
                    return {messageId: `m${sent.length}`};
                },
            },
            RATE_LIMITER: {limit: async () => ({success: !limited})},
        },
    };
}

function form(fields = {}, files = []) {
    const body = new FormData();
    const values = {email: 'anna@example.com', message: 'The route goes over the fence.', ...fields};
    for (const [name, value] of Object.entries(values)) {
        if (value !== undefined) {
            body.set(name, value);
        }
    }
    for (const file of files) {
        body.append('file', file);
    }
    return body;
}

function post(body, headers = {}) {
    return new Request('https://trailroutine-feedback.test/feedback', {
        method: 'POST',
        body,
        headers: {Origin: ORIGIN, ...headers},
    });
}

describe('Feedback message', () => {
    test('Message with a file and the context', async () => {
        const {env, sent} = environment();
        const file = new File(['png bytes'], 'route.png', {type: 'image/png'});
        const response = await worker.fetch(
            post(form({context: 'Page: https://trailroutine.com/#m=14/41.69/44.8'}, [file])),
            env,
        );
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
        expect(sent).toHaveLength(1);
        const [message] = sent;
        expect(message.to).toBe('owner@example.com');
        expect(message.from).toEqual({email: 'feedback@trailroutine.com', name: 'trailroutine feedback'});
        expect(message.replyTo).toBe('anna@example.com');
        expect(message.subject).toBe('Feedback: The route goes over the fence.');
        expect(message.text).toContain('The route goes over the fence.');
        expect(message.text).toContain('From: anna@example.com');
        expect(message.text).toContain('Page: https://trailroutine.com/#m=14/41.69/44.8');
        expect(message.attachments).toHaveLength(1);
        expect(message.attachments[0]).toMatchObject({
            filename: 'route.png',
            type: 'image/png',
            disposition: 'attachment',
        });
        expect(new TextDecoder().decode(message.attachments[0].content)).toBe('png bytes');
    });

    test('a line break in the message does not go into the subject', async () => {
        const {env, sent} = environment();
        await worker.fetch(post(form({message: 'First line\r\nBcc: someone@example.com'})), env);
        expect(sent[0].subject).not.toMatch(/[\r\n]/u);
    });

    test('Email is required', async () => {
        for (const email of [undefined, '', 'not an address']) {
            const {env, sent} = environment();
            const response = await worker.fetch(post(form({email})), env);
            expect(response.status).toBe(400);
            expect(await response.text()).toBe('Email is not valid');
            expect(sent).toHaveLength(0);
        }
    });

    test('empty message', async () => {
        const {env, sent} = environment();
        const response = await worker.fetch(post(form({message: '   '})), env);
        expect(response.status).toBe(400);
        expect(sent).toHaveLength(0);
    });

    test('Files over the limit', async () => {
        const {env, sent} = environment();
        const big = new File([new Uint8Array(MAX_FILES_BYTES + 1)], 'big.bin');
        const response = await worker.fetch(post(form({}, [big])), env);
        expect(response.status).toBe(413);
        const many = Array.from({length: MAX_FILES + 1}, (_, i) => new File(['x'], `f${i}.txt`));
        expect((await worker.fetch(post(form({}, many)), env)).status).toBe(400);
        expect(sent).toHaveLength(0);
    });

    test('Rate limit', async () => {
        const {env, sent} = environment({limited: true});
        const response = await worker.fetch(post(form(), {'CF-Connecting-IP': '203.0.113.7'}), env);
        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('60');
        expect(sent).toHaveLength(0);
    });

    test('Request from another site', async () => {
        const {env, sent} = environment();
        const response = await worker.fetch(post(form(), {Origin: 'https://evil.example'}), env);
        expect(response.status).toBe(403);
        expect(sent).toHaveLength(0);
    });

    test('preflight', async () => {
        const {env} = environment();
        const response = await worker.fetch(
            new Request('https://trailroutine-feedback.test/feedback', {
                method: 'OPTIONS',
                headers: {Origin: ORIGIN, 'Access-Control-Request-Headers': 'content-type'},
            }),
            env,
        );
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS');
    });

    test('Email delivery fails', async () => {
        const {env} = environment({failure: 'destination is not verified'});
        const response = await worker.fetch(post(form()), env);
        expect(response.status).toBe(502);
        expect(await response.text()).toBe('Could not send the message');
    });

    test('no recipient: the service is not configured', async () => {
        const {env, sent} = environment({to: ''});
        const response = await worker.fetch(post(form()), env);
        expect(response.status).toBe(503);
        expect(sent).toHaveLength(0);
    });
});
