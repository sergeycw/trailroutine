import type { SavedTrack } from '@/autosave/saved';

// A saved track for the tests of the move (unit tests and e2e build the same record)
export const MOVED_TRACK: SavedTrack = {
    name: 'Kazbegi loop',
    color: 3,
    visible: true,
    measureTicksShown: false,
    // the last digit of a float64 must survive the move
    segments: [new Float64Array([42.657000000000004, 44.6431, 42.66, 44.65, 42.67, 44.66])],
    points: [{ lat: 42.66, lng: 44.65, name: 'Gergeti' }],
    routes: [null],
};

// localStorage in memory for the unit tests of the move
export function memoryStorage(entries: Record<string, string> = {}): Storage {
    const values = new Map(Object.entries(entries));
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: (key) => void values.delete(key),
        clear: () => values.clear(),
        key: (index) => [...values.keys()][index] ?? null,
        get length() {
            return values.size;
        },
    };
}
