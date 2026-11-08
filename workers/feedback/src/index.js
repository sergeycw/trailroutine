// The feedback service (change add-feedback, spec feedback): the form of the app sends a message with an email for a
// reply, files and the context of the page, and the Worker sends it as an email to the owner through the send_email
// binding of Email Routing. The user does not see the transport: the app knows only POST /feedback.

// The files of one message; base64 in the email adds a third, and the email limit is 25 MiB
// (developers.cloudflare.com/email-service/platform/limits).
export const MAX_FILES_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
// The whole form: the files and the text fields, with a margin for the multipart headers.
const MAX_BODY_BYTES = MAX_FILES_BYTES + 256 * 1024;
export const MAX_MESSAGE_LENGTH = 10000;
const MAX_CONTEXT_LENGTH = 4000;
// RFC 5321: an address is at most 254 characters.
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SUBJECT_TEXT_LENGTH = 60;
const ALLOWED_METHODS = 'POST, OPTIONS';
// The window length of `[[ratelimits]]` in wrangler.toml.
const RETRY_AFTER_SECONDS = '60';

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

function respond(origin, status, body = null, headers = {}) {
    return new Response(body, {
        status,
        headers: {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', ...headers},
    });
}

// Without CF-Connecting-IP (local wrangler dev, tests) the rate is not limited.
async function overLimit(request, limiter) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) {
        return false;
    }
    const {success} = await limiter.limit({key: ip});
    return !success;
}

function preflight(request, origin) {
    const headers = {'Access-Control-Allow-Methods': ALLOWED_METHODS};
    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    if (requestedHeaders) {
        headers['Access-Control-Allow-Headers'] = requestedHeaders;
    }
    return respond(origin, 204, null, headers);
}

// The body up to limit bytes, null if it is longer: formData() alone would read any length into memory.
async function readLimited(request, limit) {
    if (Number(request.headers.get('Content-Length')) > limit) {
        return null;
    }
    if (!request.body) {
        return new Uint8Array();
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of request.body) {
        total += chunk.byteLength;
        if (total > limit) {
            return null;
        }
        chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

// A header value without line breaks: a CR or LF in a subject or a file name would start a new header
function headerSafe(text, length) {
    return text.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, length);
}

function text(form, name) {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
}

// The checked form, or a string with the reason for 400
async function readForm(bytes, contentType) {
    let form;
    try {
        form = await new Response(bytes, {headers: {'Content-Type': contentType}}).formData();
    } catch {
        return 'Not a form';
    }
    const email = text(form, 'email').trim();
    const message = text(form, 'message').trim();
    const context = text(form, 'context').trim();
    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        return 'Email is not valid';
    }
    if (!message) {
        return 'Message is empty';
    }
    if (message.length > MAX_MESSAGE_LENGTH || context.length > MAX_CONTEXT_LENGTH) {
        return 'Message is too long';
    }
    const files = form.getAll('file').filter((file) => typeof file !== 'string');
    if (files.length > MAX_FILES) {
        return 'Too many files';
    }
    return {email, message, context, files};
}

async function attachments(files) {
    return Promise.all(
        files.map(async (file) => ({
            content: await file.arrayBuffer(),
            filename: headerSafe(file.name, 200) || 'file',
            type: file.type || 'application/octet-stream',
            disposition: 'attachment',
        })),
    );
}

function emailText({email, message, context}) {
    return [message, '', '--', `From: ${email}`, ...(context ? [context] : [])].join('\n');
}

async function sendFeedback(request, env, origin) {
    if (!env.FEEDBACK_TO) {
        return respond(origin, 503, 'Feedback is not configured');
    }
    const bytes = await readLimited(request, MAX_BODY_BYTES);
    if (!bytes) {
        return respond(origin, 413, 'Files are too big');
    }
    const form = await readForm(bytes, request.headers.get('Content-Type') ?? '');
    if (typeof form === 'string') {
        return respond(origin, 400, form);
    }
    if (form.files.reduce((sum, file) => sum + file.size, 0) > MAX_FILES_BYTES) {
        return respond(origin, 413, 'Files are too big');
    }
    try {
        await env.EMAIL.send({
            from: {email: env.FEEDBACK_FROM, name: 'trailroutine feedback'},
            to: env.FEEDBACK_TO,
            replyTo: form.email,
            subject: `Feedback: ${headerSafe(form.message, SUBJECT_TEXT_LENGTH)}`,
            text: emailText(form),
            attachments: await attachments(form.files),
        });
    } catch (error) {
        // the code and the text go to Workers Logs; the user gets only «could not send»
        console.error('feedback email not sent:', error?.code, error?.message);
        return respond(origin, 502, 'Could not send the message');
    }
    return respond(origin, 204);
}

const worker = {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        if (!origin || !allowedOrigins(env).includes(origin)) {
            return new Response('Origin not allowed', {status: 403});
        }
        if (request.method === 'OPTIONS') {
            return preflight(request, origin);
        }
        if (new URL(request.url).pathname !== '/feedback') {
            return respond(origin, 404, 'Not found');
        }
        if (request.method !== 'POST') {
            return respond(origin, 405, 'Method not allowed', {Allow: ALLOWED_METHODS});
        }
        if (await overLimit(request, env.RATE_LIMITER)) {
            return respond(origin, 429, 'Too many requests\n', {'Retry-After': RETRY_AFTER_SECONDS});
        }
        return sendFeedback(request, env, origin);
    },
};

export default worker;
