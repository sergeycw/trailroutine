// Rate limit per IP before the function (requirement «Частота запросов к Pages Functions», worker-limits).
// The middleware is in the directory of the function, not in the root of functions/: a root middleware makes
// each request to the static files of the site billable.
import {rateLimited} from '../../workers/guard/src/client';

export const onRequest = rateLimited;
