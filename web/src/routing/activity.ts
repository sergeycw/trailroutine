import { getActivity } from './brouter';

// The selected activity in localStorage (spec routing, «Выбор активности сохраняется»). Own key: the origin is shared
// with the old client. While there is no own key, the app takes the old client selection (trackListRoutingActivity),
// as the layer settings do (layers/settings.ts): the app only reads the old key. An unknown identifier: routing is off.

const STORAGE_KEY = 'nakarte-web:routing-activity';
const LEGACY_STORAGE_KEY = 'trackListRoutingActivity';

function read(storage: Storage, key: string): string | null {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

export function loadActivity(storage: Storage | null): string | null {
    if (!storage) {
        return null;
    }
    const own = read(storage, STORAGE_KEY);
    return getActivity(own ?? read(storage, LEGACY_STORAGE_KEY))?.id ?? null;
}

// «Off» removes the own key; the app does not touch the old key, because the old client writes it. Without the own key,
// the old selection would come back after «Off», so «Off» writes an empty string, not a removal, if the old key exists.
export function saveActivity(storage: Storage | null, id: string | null): void {
    try {
        if (id) {
            storage?.setItem(STORAGE_KEY, id);
        } else if (storage && read(storage, LEGACY_STORAGE_KEY) !== null) {
            storage.setItem(STORAGE_KEY, '');
        } else {
            storage?.removeItem(STORAGE_KEY);
        }
    } catch {
        // the storage is not available or is full: the selection lives until a reload
    }
}
