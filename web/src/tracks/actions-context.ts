import { createContext, useContext } from 'react';
import type { TrackActions } from './actions';

// Track list actions for components: App creates them once with its own network and notices
export const TrackActionsContext = createContext<TrackActions | null>(null);

export function useTrackActions(): TrackActions {
    const actions = useContext(TrackActionsContext);
    if (!actions) {
        throw new Error('useTrackActions outside TrackActionsContext');
    }
    return actions;
}
