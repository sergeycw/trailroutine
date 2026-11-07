import {describe, expect, it} from 'vitest';

import {onRequest} from '../../../functions/brouter-wasm/[[path]].js';

const JAR = Uint8Array.from({length: 500}, (_, i) => i % 256);
const JAR_URL = 'https://clone.test/brouter-wasm/lib/brouter.jar';

// Pages static files do not support Range and give the full file; the function cuts it itself.
const env = {
    ASSETS: {
        fetch(request) {
            if (new URL(request.url).pathname !== '/brouter-wasm/lib/brouter.jar') {
                return new Response('Not found', {status: 404});
            }
            return new Response(JAR, {headers: {'Content-Type': 'application/java-archive', 'ETag': '"jar"'}});
        },
    },
};

function call(url, {method = 'GET', headers = {}} = {}) {
    return onRequest({request: new Request(url, {method, headers}), env});
}

async function bytes(response) {
    return new Uint8Array(await response.arrayBuffer());
}

describe('functions/brouter-wasm', () => {
    it('answers a range with 206 and Content-Range', async () => {
        const response = await call(JAR_URL, {headers: {Range: 'bytes=0-0'}});
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 0-0/500');
        expect(response.headers.get('Content-Length')).toBe('1');
        expect(response.headers.get('Accept-Ranges')).toBe('bytes');
        expect(await bytes(response)).toEqual(JAR.slice(0, 1));
    });

    it('clips an open range to the end of the file', async () => {
        const response = await call(JAR_URL, {headers: {Range: 'bytes=490-'}});
        expect(response.status).toBe(206);
        expect(response.headers.get('Content-Range')).toBe('bytes 490-499/500');
        expect(await bytes(response)).toEqual(JAR.slice(490));
    });

    it('answers a suffix range', async () => {
        const response = await call(JAR_URL, {headers: {Range: 'bytes=-5'}});
        expect(response.headers.get('Content-Range')).toBe('bytes 495-499/500');
        expect(await bytes(response)).toEqual(JAR.slice(495));
    });

    it('answers 416 to a range past the end', async () => {
        const response = await call(JAR_URL, {headers: {Range: 'bytes=600-700'}});
        expect(response.status).toBe(416);
        expect(response.headers.get('Content-Range')).toBe('bytes */500');
    });

    it('answers the whole file without Range', async () => {
        const response = await call(JAR_URL);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Length')).toBe('500');
        expect(await bytes(response)).toEqual(JAR);
    });

    it('answers HEAD without a body', async () => {
        const response = await call(JAR_URL, {method: 'HEAD', headers: {Range: 'bytes=0-0'}});
        expect(response.status).toBe(206);
        expect(await response.text()).toBe('');
    });

    it('passes a missing asset through', async () => {
        const response = await call('https://clone.test/brouter-wasm/lib/missing.jar');
        expect(response.status).toBe(404);
    });
});
