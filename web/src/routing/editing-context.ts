import { createContext, useContext } from 'react';
import type { RouteEditing } from './editing';

// The editor-store connection for components: App creates it one time with its own router and notices
export const RouteEditingContext = createContext<RouteEditing | null>(null);

export function useRouteEditing(): RouteEditing {
    const editing = useContext(RouteEditingContext);
    if (!editing) {
        throw new Error('useRouteEditing outside RouteEditingContext');
    }
    return editing;
}
