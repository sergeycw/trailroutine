import { createContext, useContext } from 'react';
import type { StreetView } from './controller';

// The Street View mode for the components: App creates it one time with its API (Google or the test stub)
export const StreetViewContext = createContext<StreetView | null>(null);

export function useStreetView(): StreetView {
    const streetView = useContext(StreetViewContext);
    if (!streetView) {
        throw new Error('useStreetView outside StreetViewContext');
    }
    return streetView;
}
