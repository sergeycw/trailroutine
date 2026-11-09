import { afterEach, describe, expect, test } from 'vitest';
import './keyless.css';

// The rules of keyless.css on a copy of the Google markup of the Street View panel (Maps JavaScript API 65, recorded
// on production on 2026-11-09, design fix-street-view-negative). The real Google scene is not in the tests: the e2e
// Google is a stub without the scene. The test titles are the scenarios of the spec clone-hosting.

function panel(keyless: boolean, canvasFilter: string | null) {
    const element = document.createElement('div');
    element.classList.toggle('google-street-view-keyless', keyless);
    element.innerHTML = `
        <div class="gm-style">
            <div aria-label="Street View" class="mapsImagerySceneScene__root widget-scene">
                <canvas class="mapsImagerySceneScene__canvas widget-scene-canvas"></canvas>
            </div>
            <div style="z-index: 1000; font-size: 20px;">For development purposes only</div>
        </div>
        <div>This page can't load Google Maps correctly.</div>`;
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    if (canvasFilter) {
        canvas.style.filter = canvasFilter;
    }
    document.body.append(element);
    const root = element.querySelector('[aria-label="Street View"]') as HTMLElement;
    const watermark = element.querySelector('[style*="z-index: 1000"]') as HTMLElement;
    const dialog = element.querySelector('.gm-style + div') as HTMLElement;
    return { canvas, root, watermark, dialog };
}

const filter = (element: Element) => getComputedStyle(element).filter;

afterEach(() => {
    document.body.replaceChildren();
});

describe('Street View без ключа без режима разработки', () => {
    test('Панорама без ключа', () => {
        const { canvas, root, watermark, dialog } = panel(true, 'invert(1)');
        // two inversions cancel each other, the canvas keeps its own filter
        expect(filter(canvas)).toBe('invert(1)');
        expect(filter(root)).toBe('invert(1)');
        expect(getComputedStyle(watermark).display).toBe('none');
        expect(getComputedStyle(dialog).display).toBe('none');
    });

    test('Панорама без ключа при блокировщике', () => {
        const { canvas, root } = panel(true, null);
        expect(filter(root)).toBe('none');
        // Google can invert the canvas later: the root follows
        canvas.style.filter = 'invert(1)';
        expect(filter(root)).toBe('invert(1)');
    });

    test('Панорама с ключом', () => {
        const { root, watermark } = panel(false, 'invert(1)');
        expect(filter(root)).toBe('none');
        expect(getComputedStyle(watermark).display).not.toBe('none');
    });
});
