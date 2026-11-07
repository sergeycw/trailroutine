import { describe, expect, it } from 'vitest';
import { formatStreetView, parseStreetView } from './hash';

const PANO = { lat: 41.693, lng: 44.78, heading: 90, pitch: 0, zoom: 1 };

describe('Street View в адресе', () => {
    it('Ссылка с панорамой', () => {
        expect(parseStreetView(['_g', 'g', '41.693000', '44.780000', '90.0', '0.0', '1.0'], undefined)).toEqual({
            enabled: true,
            pano: PANO,
        });
    });

    it('режим без панорамы', () => {
        expect(parseStreetView(['_g'], undefined)).toEqual({ enabled: true, pano: null });
    });

    it('Старая ссылка n=', () => {
        expect(parseStreetView(undefined, ['41.693000', '44.780000', '90.0', '0.0', '1.0'])).toEqual({
            enabled: true,
            pano: PANO,
        });
        expect(parseStreetView(undefined, [])).toEqual({ enabled: true, pano: null });
    });

    it.each([[['_w']], [['wmc']], [['_wmc']], [[]], [['']]])('Удалённый провайдер %j — режим выключен', (n2) => {
        expect(parseStreetView(n2, undefined)).toEqual({ enabled: false, pano: null });
    });

    it('неверные числа панорамы — режим без панорамы', () => {
        expect(parseStreetView(['_g', 'g', 'x', '44', '1', '2', '3'], undefined)).toEqual({
            enabled: true,
            pano: null,
        });
        expect(parseStreetView(['_g', 'g', '41'], undefined)).toEqual({ enabled: true, pano: null });
        // a panorama of a different provider with Google on gives no panorama
        expect(parseStreetView(['_gw', 'w', '41', '44', '1', '2', '3'], undefined)).toEqual({
            enabled: true,
            pano: null,
        });
    });

    it('запись — формат getState старого клиента', () => {
        expect(formatStreetView({ enabled: false, pano: PANO })).toBeNull();
        expect(formatStreetView({ enabled: true, pano: null })).toEqual(['_g']);
        expect(
            formatStreetView({
                enabled: true,
                pano: { lat: 41.6930001, lng: 44.78, heading: 90.04, pitch: -3.26, zoom: 1 },
            }),
        ).toEqual(['_g', 'g', '41.693000', '44.780000', '90.0', '-3.3', '1.0']);
    });
});
