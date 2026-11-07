import { normalizeColor, parseHex } from './color';

// Recent custom palette colors (design track-color-picker, «Недавние цвета»): local to one browser, not track data.
// The storage can be unavailable (a private window, a site block): then the palette row has only the preset colors.

const KEY = 'nakarte-web:recent-colors';
// three: the palette row of six always keeps the first three preset colors (design palette-one-row)
export const RECENT_COLORS_LIMIT = 3;

export function readRecentColors(): string[] {
    try {
        const value: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
        if (!Array.isArray(value)) {
            return [];
        }
        const colors = value
            .map((item) => (typeof item === 'string' ? parseHex(item) : null))
            .filter((hex): hex is string => hex !== null && typeof normalizeColor(hex) === 'string');
        return [...new Set(colors)].slice(0, RECENT_COLORS_LIMIT);
    } catch {
        return [];
    }
}

// The newest color first, without repeats; palette colors do not go here: they are in the palette row already
export function rememberColor(hex: string): void {
    if (typeof normalizeColor(hex) !== 'string') {
        return;
    }
    try {
        const colors = [hex, ...readRecentColors().filter((color) => color !== hex)].slice(0, RECENT_COLORS_LIMIT);
        window.localStorage.setItem(KEY, JSON.stringify(colors));
    } catch {
        // without a storage, there are no recent colors
    }
}
