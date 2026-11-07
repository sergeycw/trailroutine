import { describe, expect, test, vi } from 'vitest';
import { type Engine, EngineStartError, type EngineStatus, EngineTimeoutError } from '@/engine/engine';
import { type Activity, getActivity, RoutingError } from './brouter';
import { createRouter, routerDownHint } from './router';

function activity(id: string): Activity {
    const found = getActivity(id);
    if (!found) {
        throw new Error(`no activity ${id}`);
    }
    return found;
}

// Scenarios of the spec browser-routing-engine («Выбор движка флагом конфигурации») and routing («Недоступный роутер»)
// on a fake fetch and a fake engine: the tests do not go to the network.

const FROM = { lat: 41.69, lng: 44.78 };
const TO = { lat: 41.7, lng: 44.79 };
const HIKING = activity('hiking');
const ROUTE = JSON.stringify({
    features: [
        {
            geometry: {
                coordinates: [
                    [44.7, 41.6],
                    [44.75, 41.7],
                    [44.85, 41.75],
                ],
            },
        },
    ],
});

function fakeEngine(route: Engine['route'], status: EngineStatus = 'idle') {
    const engine = {
        start: vi.fn(async () => {}),
        route: vi.fn(route),
        status: () => status,
        backend: () => null,
        subscribe: () => () => {},
    } satisfies Engine;
    return engine;
}

const noFetch: typeof fetch = async () => {
    throw new Error('fetch must not be called');
};

describe('Выбор движка флагом конфигурации', () => {
    test('Сборка по умолчанию', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(ROUTE));
        const getEngine = vi.fn();
        const router = createRouter({ engine: 'server', routingServer: 'http://localhost:17777', fetch, getEngine });
        const nodes = await router.route(FROM, TO, HIKING);
        expect(nodes).toHaveLength(3);
        const url = new URL(String(fetch.mock.calls[0][0]));
        expect(url.origin + url.pathname).toBe('http://localhost:17777/brouter');
        expect(url.searchParams.get('profile')).toBe('hiking-mountain');
        expect(getEngine).not.toHaveBeenCalled();
        expect(router.status()).toBe('ready');
    });

    test('Движок в браузере', async () => {
        const engine = fakeEngine(async () => ROUTE);
        const router = createRouter({
            engine: 'browser',
            routingServer: 'http://localhost:17777',
            fetch: noFetch,
            getEngine: () => engine,
        });
        expect(await router.route(FROM, TO, HIKING)).toHaveLength(3);
        expect(new URLSearchParams(engine.route.mock.calls[0][0]).get('lonlats')).toBe(
            '44.780000,41.690000|44.790000,41.700000',
        );
    });

    test('движок не создаётся, пока его не позвали', () => {
        const getEngine = vi.fn();
        createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine });
        expect(getEngine).not.toHaveBeenCalled();
    });

    test('прогрев запускает только движок в браузере', () => {
        const engine = fakeEngine(async () => ROUTE);
        createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine }).warmUp();
        expect(engine.start).toHaveBeenCalledOnce();
        const getEngine = vi.fn();
        createRouter({ engine: 'server', routingServer: 'http://localhost:17777', fetch: noFetch, getEngine }).warmUp();
        expect(getEngine).not.toHaveBeenCalled();
    });
});

describe('Недоступный роутер', () => {
    test('сервер не отвечает — роутер недоступен', async () => {
        const fetch: typeof globalThis.fetch = async () => {
            throw new TypeError('Failed to fetch');
        };
        const router = createRouter({
            engine: 'server',
            routingServer: 'http://localhost:17777',
            fetch,
            getEngine: vi.fn(),
        });
        const error = await router.route(FROM, TO, HIKING).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RoutingError);
        expect((error as RoutingError).unreachable).toBe(true);
        expect(await router.isReachable()).toBe(false);
    });

    test('ошибка сервера — причина из ответа, роутер жив', async () => {
        const fetch: typeof globalThis.fetch = async () =>
            new Response('datafile E30_N55.rd5 not found\n', { status: 500 });
        const router = createRouter({
            engine: 'server',
            routingServer: 'http://localhost:17777',
            fetch,
            getEngine: vi.fn(),
        });
        const error = (await router.route(FROM, TO, HIKING).catch((e: unknown) => e)) as RoutingError;
        expect(error.message).toBe('no routing data for this area');
        expect(error.unreachable).toBe(false);
    });

    test('проверка живости: 404 на GET /brouter — сервер жив', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 404 }));
        const router = createRouter({
            engine: 'server',
            routingServer: 'http://localhost:17777',
            fetch,
            getEngine: vi.fn(),
        });
        expect(await router.isReachable()).toBe(true);
        expect(String(fetch.mock.calls[0][0])).toBe('http://localhost:17777/brouter');
    });

    test('Движок в браузере не запустился', async () => {
        const engine = fakeEngine(async () => {
            throw new EngineStartError('BRouter engine failed to start: no CDN');
        }, 'failed');
        const router = createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine });
        const error = (await router.route(FROM, TO, HIKING).catch((e: unknown) => e)) as RoutingError;
        expect(error.unreachable).toBe(true);
        expect(await router.isReachable()).toBe(false);
    });

    test('ошибка маршрута в движке — роутер жив', async () => {
        const engine = fakeEngine(async () => {
            throw new Error('no track found');
        }, 'ready');
        const router = createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine });
        const error = (await router.route(FROM, TO, HIKING).catch((e: unknown) => e)) as RoutingError;
        expect(error.message).toBe('no track found');
        expect(error.unreachable).toBe(false);
    });

    test('Движок не ответил вовремя: ошибка отрезка, роутер жив', async () => {
        const engine = fakeEngine(async () => {
            throw new EngineTimeoutError('BRouter engine did not answer in 60 s');
        }, 'idle');
        const router = createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine });
        const error = (await router.route(FROM, TO, HIKING).catch((e: unknown) => e)) as RoutingError;
        expect(error).toBeInstanceOf(RoutingError);
        expect(error.message).toBe('BRouter engine did not answer in 60 s');
        expect(error.unreachable).toBe(false);
        expect(await router.isReachable()).toBe(true);
    });

    test('Завис движок на главном потоке: роутер недоступен, подсказка — перезагрузить страницу', async () => {
        const engine = fakeEngine(async () => {
            throw new EngineStartError('BRouter engine stopped responding');
        }, 'failed');
        const router = createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine });
        const error = (await router.route(FROM, TO, HIKING).catch((e: unknown) => e)) as RoutingError;
        expect(error.unreachable).toBe(true);
        expect(await router.isReachable()).toBe(false);
        expect(routerDownHint('browser')).toContain('reload the page');
    });
});

describe('Отмена', () => {
    test('отменённый запрос сервера отклоняется причиной отмены, а не ошибкой маршрута', async () => {
        const fetch: typeof globalThis.fetch = (_url, init) =>
            new Promise((_resolve, reject) =>
                init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
            );
        const router = createRouter({
            engine: 'server',
            routingServer: 'http://localhost:17777',
            fetch,
            getEngine: vi.fn(),
        });
        const controller = new AbortController();
        const result = router.route(FROM, TO, HIKING, controller.signal).catch((e: unknown) => e);
        controller.abort();
        const error = await result;
        expect(error).not.toBeInstanceOf(RoutingError);
        expect((error as Error).name).toBe('AbortError');
    });

    test('отменённый запрос движка', async () => {
        const controller = new AbortController();
        const engine = fakeEngine(
            (_query, signal) =>
                new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))),
        );
        const router = createRouter({ engine: 'browser', routingServer: '', fetch: noFetch, getEngine: () => engine });
        const result = router.route(FROM, TO, HIKING, controller.signal).catch((e: unknown) => e);
        controller.abort();
        expect(await result).toBe(controller.signal.reason);
    });
});

// Spec routing, «Доступность и подсказка по движку»
describe('Доступность и подсказка по движку', () => {
    test('Серверный BRouter не запущен', () => {
        expect(routerDownHint('server')).toBe('BRouter is not running, start it with docker compose up -d');
    });

    test('Движок в браузере не запустился', () => {
        expect(routerDownHint('browser')).toBe('BRouter engine failed to load, reload the page to retry');
        expect(routerDownHint('browser')).not.toContain('docker compose');
    });
});
