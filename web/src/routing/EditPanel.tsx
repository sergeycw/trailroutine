import { CheckIcon, LoaderCircleIcon, Redo2Icon, Share2Icon, Undo2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppStore } from '@/state/context';
import { ColorPicker } from '@/tracks/ColorPicker';
import { formatLength, tracksLength } from '@/tracks/geometry';
import { TrackExportItems } from '@/tracks/TrackExportItems';
import { useRouteEditing } from './editing-context';
import { RoutingButton } from './RoutingButton';
import { TrackNameInput } from './TrackNameInput';

// The line editor in the top row instead of the search (mock-up 4a, design polish-web-ui; before: a bar at the bottom
// center, decision of the owner 2026-10-09): color palette, name field and track length, routing activity, Undo, Redo,
// «Share track», the check mark «Finish editing» (name, color and export without an exit from editing: design
// editor-name-share and editor-row-cleanup; below 640 px Cancel and the activity are icons only). A phone needs the
// check mark: it has no Escape. The hint for the Join and Shortcut choice is not here but at the point on the map, as
// in the mock-up (ToolHintOnMap, design editor-hint-at-point).
export function EditPanel() {
    const editing = useRouteEditing();
    const edit = useAppStore((state) => state.routeEdit);
    const track = useAppStore((state) => state.tracks.find((item) => item.id === state.routeEdit?.trackId));
    const tool = useAppStore((state) => state.lineTool);
    const loading = useAppStore((state) => state.loadingTracks > 0);
    if (!edit || !track) {
        return null;
    }
    return (
        // data-drawing is the drawing mode for tests: before, tests detected it by the hint text
        <div className="w-full" data-testid="edit-panel" data-drawing={edit.drawing || undefined}>
            <div className="glass pointer-events-auto flex h-11 w-full items-center gap-1 rounded-xl px-2">
                <ColorPicker track={track} />
                <TrackNameInput key={track.id} track={track} />
                {/* the track length while you draw: the track list button is not in the top row at that time */}
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums" data-testid="edit-length">
                    {formatLength(tracksLength(track.segments))}
                </span>
                <RoutingButton labeled />
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Undo"
                    title="Undo (Cmd/Ctrl+Z)"
                    // the Join and Shortcut choice on the map (design add-web-line-tools): a line edit would shift the
                    // index of the point that the choice starts from
                    disabled={!edit.canUndo || tool !== null}
                    onClick={editing.undo}
                >
                    <Undo2Icon />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Redo"
                    title="Redo (Cmd/Ctrl+Shift+Z)"
                    disabled={!edit.canRedo || tool !== null}
                    onClick={editing.redo}
                >
                    <Redo2Icon />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Share track"
                                title="Share track"
                                aria-busy={loading || undefined}
                            />
                        }
                    >
                        {/* «Save as GPX» waits for the elevation API, and in the editor there is no Tracks button
                            with a spinner (design trim-track-menus) */}
                        {loading ? <LoaderCircleIcon className="animate-spin" /> : <Share2Icon />}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto">
                        <TrackExportItems track={track} />
                    </DropdownMenuContent>
                </DropdownMenu>
                {tool ? (
                    <Button size="sm" variant="outline" aria-label="Cancel" onClick={editing.cancelTool}>
                        <XIcon />
                        <span className="max-sm:hidden">Cancel</span>
                    </Button>
                ) : (
                    // a --primary fill, not the glass of the round map buttons: glass on a glass row is hard to see
                    <Button
                        size="icon-sm"
                        className="rounded-full"
                        aria-label="Finish editing"
                        title="Finish editing"
                        onClick={editing.stop}
                    >
                        <CheckIcon />
                    </Button>
                )}
            </div>
        </div>
    );
}
