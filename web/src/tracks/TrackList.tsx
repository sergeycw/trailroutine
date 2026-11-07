import { EllipsisIcon, EllipsisVerticalIcon, FolderOpenIcon, ListIcon, LoaderCircleIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { ROUND_BUTTON } from '@/components/round-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useElevationProfile } from '@/elevation/context';
import { cn } from '@/lib/utils';
import { useRouteEditing } from '@/routing/editing-context';
import { tracksRouting } from '@/routing/line';
import { RouteThread } from '@/routing/RouteThread';
import { RoutingButton } from '@/routing/RoutingButton';
import { useAppStore } from '@/state/context';
import { useTrackActions } from './actions-context';
import { ColorPicker } from './ColorPicker';
import { formatLength, tracksLength } from './geometry';
import type { Track } from './model';
import { RenameTrackDialog } from './TrackDialogs';
import { TrackExportItems } from './TrackExportItems';

// Track list (design add-web-tracks, «Список треков»; layout: mock-up 4a, design polish-web-ui): a header with the
// list menu, track rows with the track menu; a track link goes into the search box (design search-track-links). The
// menu texts are from the old client. Actions: createTrackActions (actions.ts).

function TrackRow({ track, onRename }: { track: Track; onRename: (track: Track) => void }) {
    const actions = useTrackActions();
    const editing = useRouteEditing();
    const profile = useElevationProfile();
    const edited = useAppStore((state) => state.routeEdit?.trackId === track.id);
    return (
        // the track in editing is highlighted (the edit class of a row in the old client)
        <li
            className={`-mx-1 flex min-h-6 items-center gap-1 rounded-md px-1 ${edited ? 'bg-muted' : ''}`}
            data-track={track.name}
            data-editing={edited || undefined}
        >
            <Checkbox
                aria-label={`Show ${track.name}`}
                checked={track.visible}
                onCheckedChange={(checked, details) =>
                    actions.setVisible(track, checked, (details.event as MouseEvent | undefined)?.shiftKey === true)
                }
            />
            <ColorPicker track={track} />
            <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer truncate text-left hover:underline"
                title={track.name}
                onClick={() => actions.showTrack(track)}
            >
                {track.name}
            </button>
            <span className="shrink-0 text-muted-foreground text-xs tabular-nums" data-testid="track-length">
                {formatLength(tracksLength(track.segments))}
            </span>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${track.name}`} />}
                >
                    <EllipsisVerticalIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto">
                    <DropdownMenuItem onClick={() => editing.addSegment(track.id)}>Add segment</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.startAddPoint(track)}>Add point</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onRename(track)}>Rename</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.duplicate(track)}>Duplicate</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.reverse(track)}>Reverse</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => actions.remove(track)}>Delete</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => profile.open(track.id)}>Show elevation profile</DropdownMenuItem>
                    {/* a Base UI checkbox item does not close the menu by itself (as RadioItem) */}
                    <DropdownMenuCheckboxItem
                        closeOnClick
                        checked={track.measureTicksShown}
                        onCheckedChange={(checked) => actions.setMeasureTicks(track, checked)}
                    >
                        Show distance marks
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <TrackExportItems track={track} />
                </DropdownMenuContent>
            </DropdownMenu>
        </li>
    );
}

// Round list button at the top left (design layout-three-zones), the list is a drop-down panel under the row (TopBar).
// The track count is data, not a label, so it is a badge in the button corner; tests find the button by the aria-label
// with the count
export function TracksButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
    const count = useAppStore((state) => state.tracks.length);
    const loading = useAppStore((state) => state.loadingTracks > 0);
    // waiting for routing after Finish editing: the editor row with the routing button is gone (spec route-editing,
    // «Ожидание прокладки в верхней строке»); the label stays «Tracks N», the wait shows in title and aria-busy
    const routing = useAppStore((state) => tracksRouting(state.tracks));
    const label = count > 0 ? `Tracks ${count}` : 'Tracks';
    return (
        <Button
            variant="ghost"
            size="icon-lg"
            className={cn(ROUND_BUTTON, 'relative aria-expanded:bg-white/90')}
            aria-label={label}
            title={routing ? `${label}. Calculating route` : label}
            aria-expanded={open}
            aria-busy={loading || routing || undefined}
            onClick={onToggle}
        >
            {/* loading by link is not routing: its own spinner; the thread shows only the wait for a route (design
                route-thread-loader) */}
            {loading ? (
                <LoaderCircleIcon className="animate-spin" aria-label="Loading tracks" />
            ) : routing ? (
                <RouteThread variant="icon" />
            ) : (
                <ListIcon />
            )}
            {count > 0 && (
                <span className="-top-1 -right-1 absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground tabular-nums leading-none">
                    {count}
                </span>
            )}
        </Button>
    );
}

// List panel: a header with the list tools (routing, file, list menu) and track rows. «New track» is a button of the
// top row
export function TrackList() {
    const actions = useTrackActions();
    const tracks = useAppStore((state) => state.tracks);
    const [renaming, setRenaming] = useState<Track | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    return (
        <Card size="sm" className="pointer-events-auto w-full gap-1 py-1.5" data-testid="track-list">
            <div className="flex items-center gap-1 px-1.5">
                <RoutingButton />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Open file"
                    title="Open file"
                    onClick={() => fileInput.current?.click()}
                >
                    <FolderOpenIcon />
                </Button>
                <input
                    ref={fileInput}
                    type="file"
                    multiple
                    hidden
                    data-testid="track-file-input"
                    onChange={(event) => {
                        actions.openFiles([...(event.target.files ?? [])]);
                        event.target.value = '';
                    }}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="ml-auto"
                                aria-label="Tracks menu"
                                title="Menu"
                            />
                        }
                    >
                        <EllipsisIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                        <DropdownMenuItem onClick={actions.copyAllLink}>Copy link for all tracks</DropdownMenuItem>
                        <DropdownMenuItem onClick={actions.copyVisibleLink}>
                            Copy link for visible tracks
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={actions.newTrackFromVisible}>
                            Create new track from all visible tracks
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={actions.removeAll}>Delete all tracks</DropdownMenuItem>
                        <DropdownMenuItem onClick={actions.removeHidden}>Delete hidden tracks</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {tracks.length > 0 ? (
                <ul
                    className="max-h-[calc(100dvh-9rem-var(--bottom-inset))] overflow-y-auto border-border/60 border-t px-2.5 pt-1"
                    aria-label="Tracks"
                >
                    {tracks.map((track) => (
                        <TrackRow key={track.id} track={track} onRename={setRenaming} />
                    ))}
                </ul>
            ) : (
                <p className="border-border/60 border-t px-3 pt-2 pb-1 text-muted-foreground text-xs">
                    No tracks yet: open or drop a file, paste a link into search or draw a new one
                </p>
            )}
            {renaming && <RenameTrackDialog track={renaming} onClose={() => setRenaming(null)} />}
        </Card>
    );
}
