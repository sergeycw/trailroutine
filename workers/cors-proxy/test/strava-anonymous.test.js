// Anonymous heatmap tiles: without cookies or with rejected cookies, the proxy gets a z≤12 tile from
// heatmap-external-*.strava.com. CloudFront and the anonymous host are stubs from vitest.config.js.
import {describe, expect, it} from 'vitest';

import worker from '../src/index.js';
import {anonymousTileUrl} from '../src/strava.js';

const ORIGIN = 'https://nakarte-routing.pages.dev';
const ENV = {ALLOWED_ORIGINS: ORIGIN};
const DEAD_COOKIES = 'CloudFront-Key-Pair-Id=k; CloudFront-Policy=p; CloudFront-Signature=dead; _strava_idcf=j';

function tile(z, x, y, px = 256) {
    return `/https/content-a.strava.com/identified/globalheat/all/hot/${z}/${x}/${y}.png?px=${px}&check=1`;
}

function request(path, env = ENV, method = 'GET') {
    return worker.fetch(new Request(`https://proxy.test${path}`, {method, headers: {Origin: ORIGIN}}), env, null);
}

describe('anonymousTileUrl', () => {
    it('maps a heatmap tile to heatmap-external up to z12 at 256 px and z11 at 512 px', () => {
        const target = 'https://content-a.strava.com/identified/globalheat/run/blue/12/2557/1514.png?px=256&c=1';
        expect(anonymousTileUrl(target)).toBe(
            'https://heatmap-external-a.strava.com/tiles/run/blue/12/2557/1514.png?px=256'
        );
        expect(anonymousTileUrl(target.replace('/1514.', '/1515.'))).toContain('heatmap-external-b.');
        expect(anonymousTileUrl(target.replace('px=256', 'px=512'))).toBeNull();
        expect(anonymousTileUrl(target.replace('/12/', '/13/'))).toBeNull();
        expect(
            anonymousTileUrl('https://content-a.strava.com/identified/globalheat/all/hot/11/1278/757.png?px=512')
        ).toContain('/11/1278/757.png?px=512');
        expect(anonymousTileUrl('https://content-a.strava.com/identified/globalheat/all/hot/12/1/2.png')).toContain(
            '?px=256'
        );
    });
});

describe('proxy without working Strava cookies', () => {
    it('serves an overview tile from the anonymous host without cookies', async () => {
        const response = await request(tile(12, 2557, 1514));
        expect(response.status).toBe(200);
        expect(response.headers.get('X-Strava-Cookies')).toBe('anonymous');
        expect(response.headers.get('X-Anonymous-Tile')).toBe('yes');
        const echo = await response.json();
        expect(echo.url).toBe('https://heatmap-external-a.strava.com/tiles/all/hot/12/2557/1514.png?px=256');
        expect(echo.headers.cookie).toBeUndefined();
    });

    it('retries anonymously when CloudFront rejects the cookies, without sending them there', async () => {
        const response = await request(tile(11, 1278, 757), {...ENV, STRAVA_COOKIES: DEAD_COOKIES});
        expect(response.headers.get('X-Strava-Cookies')).toBe('anonymous');
        const echo = await response.json();
        expect(echo.url).toContain('heatmap-external-');
        expect(echo.headers.cookie).toBeUndefined();
    });

    it('answers HEAD from the anonymous host with no body', async () => {
        const response = await request(tile(10, 639, 378), ENV, 'HEAD');
        expect(response.headers.get('X-Strava-Cookies')).toBe('anonymous');
        expect(await response.text()).toBe('');
    });

    it('passes the CloudFront answer through above the anonymous zoom', async () => {
        const none = await request(tile(13, 5114, 3028));
        expect(none.status).toBe(403);
        expect(none.headers.get('X-Strava-Cookies')).toBe('none');
        expect(none.headers.get('X-Anonymous-Tile')).toBeNull();

        const retina = await request(tile(12, 2557, 1514, 512));
        expect(retina.status).toBe(403);
        expect(retina.headers.get('X-Strava-Cookies')).toBe('none');

        const dead = await request(tile(14, 10228, 6056), {...ENV, STRAVA_COOKIES: DEAD_COOKIES});
        expect(dead.status).toBe(403);
        expect(dead.headers.get('X-Strava-Cookies')).toBe('fallback');
    });
});
