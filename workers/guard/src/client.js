// Middleware of the Pages functions (functions/*/_middleware.js): asks nakarte-guard through the service binding
// GUARD if the client IP is within the limit. A call through a service binding is not billed as a request.
// Without CF-Connecting-IP, without the binding (local wrangler pages dev, tests) and on a counter failure, the
// request passes: a counter failure must not break the routing.

// The window length of [[ratelimits]] in workers/guard/wrangler.toml.
const RETRY_AFTER_SECONDS = '60';
// The address has no effect for a service binding: the request goes directly to the Worker.
const GUARD_URL = 'https://guard/';

async function allowed(request, env) {
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip || !env.GUARD) {
        return true;
    }
    try {
        const answer = await env.GUARD.fetch(GUARD_URL, {headers: {'X-Client-IP': ip}});
        return answer.status !== 429;
    } catch {
        return true;
    }
}

export async function rateLimited(context) {
    if (await allowed(context.request, context.env)) {
        return context.next();
    }
    return new Response('Too many requests\n', {status: 429, headers: {'Retry-After': RETRY_AFTER_SECONDS}});
}
