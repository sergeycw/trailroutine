import { describe, expect, test } from 'vitest';
import { memoryStorage } from '@/test/memory-storage';
import { loadActivity, saveActivity } from './activity';

// Scenarios of the spec routing, «Выбор активности сохраняется»

describe('Выбор активности сохраняется', () => {
    test('Перезагрузка страницы', () => {
        const storage = memoryStorage();
        saveActivity(storage, 'mtb');
        expect(loadActivity(storage)).toBe('mtb');
    });

    test('Неизвестная сохранённая активность', () => {
        expect(loadActivity(memoryStorage({ 'nakarte-web:routing-activity': 'ski' }))).toBeNull();
    });

    test('Выбор из старого клиента', () => {
        expect(loadActivity(memoryStorage({ trackListRoutingActivity: 'gravel' }))).toBe('gravel');
    });

    test('свой выбор важнее старого', () => {
        const storage = memoryStorage({ trackListRoutingActivity: 'gravel' });
        saveActivity(storage, 'hiking');
        expect(loadActivity(storage)).toBe('hiking');
        expect(storage.getItem('trackListRoutingActivity')).toBe('gravel');
    });

    test('«Off» удаляет выбор и не возвращает выбор старого клиента', () => {
        const own = memoryStorage();
        saveActivity(own, 'mtb');
        saveActivity(own, null);
        expect(own.getItem('nakarte-web:routing-activity')).toBeNull();
        expect(loadActivity(own)).toBeNull();

        const legacy = memoryStorage({ trackListRoutingActivity: 'gravel' });
        saveActivity(legacy, null);
        expect(loadActivity(legacy)).toBeNull();
    });

    test('без хранилища — прокладка выключена', () => {
        expect(loadActivity(null)).toBeNull();
        saveActivity(null, 'mtb');
    });
});
