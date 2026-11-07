// In-memory localStorage for unit tests in Node
export function memoryStorage(items: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(items));
    return {
        get length() {
            return data.size;
        },
        clear: () => data.clear(),
        getItem: (key) => data.get(key) ?? null,
        key: (index) => [...data.keys()][index] ?? null,
        removeItem: (key) => data.delete(key),
        setItem: (key, value) => data.set(key, value),
    };
}
