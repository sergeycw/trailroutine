import type { AutosaveStorage } from '@/autosave/autosave';

// In-memory autosave storage for browser tests: the record is a structured clone, as in IndexedDB
export function memoryAutosave(): AutosaveStorage {
    let record: unknown;
    return {
        load: async () => (record === undefined ? undefined : structuredClone(record)),
        save: async (next) => {
            record = structuredClone(next);
        },
    };
}
