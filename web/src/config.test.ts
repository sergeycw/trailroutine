import { describe, expect, test } from 'vitest';
import { makeConfig } from './config';

describe('Адреса сервисов клона', () => {
    test('Сборка клона', () => {
        const config = makeConfig('clone');
        expect(config.routingEngine).toBe('browser');
        expect(config.routingTilesPath).toBe('/tiles/');
        for (const url of [config.corsProxyUrl, config.tracksStorageServer, config.elevationsServer]) {
            expect(new URL(url).hostname).toMatch(/\.nakarte-routing\.workers\.dev$/);
        }
    });

    test('Локальная сборка', () => {
        const local = makeConfig('development');
        const clone = makeConfig('clone');
        expect(local.routingEngine).toBe('server');
        expect(makeConfig('production').routingEngine).toBe('server');
        expect(local.corsProxyUrl).toBe(clone.corsProxyUrl);
        expect(local.tracksStorageServer).toBe(clone.tracksStorageServer);
        expect(local.elevationsServer).toBe(clone.elevationsServer);
    });

    test('Рантайм движка с CDN Leaning Technologies', () => {
        for (const mode of ['clone', 'development']) {
            expect(new URL(makeConfig(mode).routingEngineRuntimeUrl).origin).toBe('https://cjrtnc.leaningtech.com');
        }
    });

    test('Адрес автора', () => {
        for (const mode of ['clone', 'development', 'production']) {
            expect(JSON.stringify(makeConfig(mode))).not.toMatch(/nakarte\.me/);
        }
    });

    test('Сборка без ключа и с ключом Google', () => {
        expect(makeConfig('clone').googleMapsApiKey).toBe('');
        expect(makeConfig('clone', 'AIza-test').googleMapsApiKey).toBe('AIza-test');
    });

    test('Move from the old address', () => {
        for (const mode of ['clone', 'development']) {
            const config = makeConfig(mode);
            expect(config.siteOrigin).toBe('https://trailroutine.com');
            expect(config.movedFromHosts).toEqual(['nakarte-routing.pages.dev']);
        }
    });

    test('Сборка без DSN и с DSN Sentry', () => {
        expect(makeConfig('clone').sentryDsn).toBe('');
        const dsn = 'https://public@o0.ingest.sentry.io/0';
        expect(makeConfig('clone', '', dsn).sentryDsn).toBe(dsn);
    });
});
