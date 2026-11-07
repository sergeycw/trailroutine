// Tells the Pages functions if the client IP is within the limit: 204 is yes, 429 is no. The IP comes
// in X-Client-IP from the middleware (src/client.js); without it, the limit does not apply.
const worker = {
    async fetch(request, env) {
        const ip = request.headers.get('X-Client-IP');
        if (!ip) {
            return new Response(null, {status: 204});
        }
        const {success} = await env.RATE_LIMITER.limit({key: ip});
        return new Response(null, {status: success ? 204 : 429});
    },
};

export default worker;
