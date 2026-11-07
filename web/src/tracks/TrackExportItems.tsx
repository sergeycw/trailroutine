import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useTrackActions } from './actions-context';
import type { Track } from './model';

// Export and link of one track: menu items shared by the track menu in the list and the «Share track» menu of the
// editor (design editor-name-share). The texts are from the old client, and the tests find the items by them.
export function TrackExportItems({ track }: { track: Track }) {
    const actions = useTrackActions();
    return (
        <>
            {/* GPX always has elevations; the label does not say it (the owner 2026-10-29, design trim-track-menus) */}
            <DropdownMenuItem onClick={() => void actions.saveGpx(track)}>Save as GPX</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.saveKml(track)}>Save as KML</DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.copyTrackLink(track)}>Copy link for track</DropdownMenuItem>
        </>
    );
}
