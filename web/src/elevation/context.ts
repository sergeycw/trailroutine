import { createContext, useContext } from 'react';
import type { ElevationProfileController } from './controller';

// The elevation profile for the components: App creates the controller one time with its fetch
export const ElevationProfileContext = createContext<ElevationProfileController | null>(null);

export function useElevationProfile(): ElevationProfileController {
    const profile = useContext(ElevationProfileContext);
    if (!profile) {
        throw new Error('useElevationProfile outside ElevationProfileContext');
    }
    return profile;
}
