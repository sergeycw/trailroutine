import { describe, expect, test } from 'vitest';
import { createFallbackGate } from './basemap-fallback';

// Spec map-layers, «Откат подложки при ошибке тайлов»: when a basemap source error causes the fallback at once, when
// after retries, and when never. Time and the network are replaced.
function gate(online = true) {
    let time = 0;
    const g = createFallbackGate(
        () => time,
        () => online,
    );
    return {
        ...g,
        at: (ms: number) => {
            time = ms;
        },
    };
}

describe('Откат подложки при ошибке тайлов', () => {
    test('Описание тайлов пропало: откат сразу, и на 404', () => {
        const g = gate();
        g.tileLoaded('Of');
        expect(g.shouldFallBack('Of', { status: 404, tile: false })).toBe(true);
        expect(g.shouldFallBack('Of', { status: undefined, tile: false })).toBe(true);
    });

    test('Нет ключа или квоты: отказ в доступе — откат сразу', () => {
        for (const status of [401, 403, 429, 503]) {
            const g = gate();
            g.tileLoaded('Tt');
            expect(g.shouldFallBack('Tt', { status, tile: true }), String(status)).toBe(true);
        }
    });

    test('Тайла нет: 404 тайла не откатывает', () => {
        const g = gate();
        expect(g.shouldFallBack('Tt', { status: 404, tile: true })).toBe(false);
    });

    test('первая загрузка подложки провалилась: откат сразу', () => {
        const g = gate();
        expect(g.shouldFallBack('Of', { status: 0, tile: true })).toBe(true);
        expect(g.shouldFallBack('Of', { status: 500, tile: true })).toBe(true);
    });

    test('Сеть пропала на секунду: пачка ошибок уже показанной подложки не откатывает', () => {
        const g = gate();
        g.tileLoaded('Of');
        for (let i = 0; i < 12; i++) {
            g.at(i * 10);
            expect(g.shouldFallBack('Of', { status: 0, tile: true })).toBe(false);
        }
    });

    test('без сети в браузере отката нет, даже до первого тайла', () => {
        const g = gate(false);
        expect(g.shouldFallBack('Of', { status: 0, tile: true })).toBe(false);
        expect(g.shouldFallBack('Of', { status: 502, tile: true })).toBe(false);
    });

    test('сбой, который тянется дольше 5 секунд, откатывает', () => {
        const g = gate();
        g.tileLoaded('Of');
        g.at(0);
        expect(g.shouldFallBack('Of', { status: 502, tile: true })).toBe(false);
        g.at(2_000);
        expect(g.shouldFallBack('Of', { status: 502, tile: true })).toBe(false);
        g.at(6_000);
        expect(g.shouldFallBack('Of', { status: 0, tile: true })).toBe(true);
    });

    test('редкие сбои дальше минуты друг от друга не копятся', () => {
        const g = gate();
        g.tileLoaded('Of');
        for (const time of [0, 70_000, 140_000, 210_000]) {
            g.at(time);
            expect(g.shouldFallBack('Of', { status: 0, tile: true })).toBe(false);
        }
    });
});
