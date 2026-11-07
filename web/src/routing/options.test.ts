import { describe, expect, test } from 'vitest';
import { memoryStorage } from '@/test/memory-storage';
import { getActivity, routeQuery } from './brouter';
import {
    DEFAULT_HIKING_OPTIONS,
    type HikingOptions,
    loadHikingOptions,
    saveHikingOptions,
    withHikingOptions,
} from './options';

function activity(id: string) {
    const found = getActivity(id);
    if (!found) {
        throw new Error(`no activity ${id}`);
    }
    return found;
}

const hiking = activity('hiking');
const trails = activity('hiking-trails');
const gravel = activity('gravel');
const A = { lat: 41.7, lng: 44.8 };
const B = { lat: 41.71, lng: 44.81 };

describe('Hiking options', () => {
    test('the default options keep the query as it was', () => {
        expect(withHikingOptions(hiking, DEFAULT_HIKING_OPTIONS)).toBe(hiking);
        expect(routeQuery(A, B, withHikingOptions(hiking, DEFAULT_HIKING_OPTIONS))).toBe(routeQuery(A, B, hiking));
    });

    test('changed options become profile overrides after the activity params', () => {
        const options: HikingOptions = { sacLimit: 2, avoidClimbs: true, allowSteps: false };
        const query = new URLSearchParams(routeQuery(A, B, withHikingOptions(trails, options)));
        expect(query.get('profile')).toBe('hiking-mountain');
        expect(query.get('profile:path_preference')).toBe('20');
        expect(query.get('profile:SAC_scale_limit')).toBe('2');
        expect(query.get('profile:consider_elevation')).toBe('1');
        expect(query.get('profile:allow_steps')).toBe('0');
    });

    test('a bike profile does not get them', () => {
        expect(withHikingOptions(gravel, { sacLimit: 6, avoidClimbs: true, allowSteps: false })).toBe(gravel);
    });

    test('the options survive a reload, a broken record gives the defaults', () => {
        const storage = memoryStorage();
        expect(loadHikingOptions(storage)).toEqual(DEFAULT_HIKING_OPTIONS);
        saveHikingOptions(storage, { sacLimit: 4, avoidClimbs: true, allowSteps: true });
        expect(loadHikingOptions(storage)).toEqual({ sacLimit: 4, avoidClimbs: true, allowSteps: true });
        storage.setItem('nakarte-web:hiking-options', '{"sacLimit":9,"avoidClimbs":true,"allowSteps":true}');
        expect(loadHikingOptions(storage)).toEqual(DEFAULT_HIKING_OPTIONS);
        storage.setItem('nakarte-web:hiking-options', 'not json');
        expect(loadHikingOptions(storage)).toEqual(DEFAULT_HIKING_OPTIONS);
        expect(loadHikingOptions(null)).toEqual(DEFAULT_HIKING_OPTIONS);
    });
});
