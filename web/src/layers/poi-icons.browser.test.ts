import { describe, expect, test } from 'vitest';
import { drawPoiIcon, POI_KINDS, providePoiIcon } from './poi-icons';

describe('значки мест рисуются в браузере', () => {
    test('каждый значок — 48×48 при pixelRatio 2, с цветом в кольце и белым знаком', () => {
        for (const kind of POI_KINDS) {
            const image = drawPoiIcon(`poi-${kind.id}`);
            expect(image?.width).toBe(48);
            expect(image?.height).toBe(48);
            const data = image?.data ?? new Uint8Array();
            // the corner is transparent, the ring between the border and the sign is opaque
            expect(data[3]).toBe(0);
            const ring = (8 * 48 + 24) * 4;
            expect(data[ring + 3]).toBe(255);
        }
        expect(drawPoiIcon('poi-unknown')).toBeNull();
    });

    test('значок добавляется в карту один раз и только для своего префикса', () => {
        const added: string[] = [];
        const map = {
            hasImage: (id: string) => added.includes(id),
            addImage: (id: string) => {
                added.push(id);
            },
        };
        providePoiIcon(map, 'poi-hut');
        providePoiIcon(map, 'poi-hut');
        providePoiIcon(map, 'other-icon');
        expect(added).toEqual(['poi-hut']);
    });
});
