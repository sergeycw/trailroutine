import { CheckIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/state/context';
import { useTrackActions } from './actions-context';
import { trackColor } from './model';

// Track point mode (design add-web-line-tools, «Точки трека»): add points with clicks or move a point. It is in the
// top row, as the line editor is (mock-up 4a, design polish-web-ui): the two modes are never on at the same time.
export function PointPanel() {
    const actions = useTrackActions();
    const tool = useAppStore((state) => state.pointTool);
    const track = useAppStore((state) => state.tracks.find((item) => item.id === state.pointTool?.trackId));
    if (!tool || !track) {
        return null;
    }
    const adding = tool.kind === 'add';
    return (
        <div className="flex w-full flex-col items-start gap-1.5" data-testid="point-panel">
            <div className="glass pointer-events-auto flex h-11 w-full items-center gap-1 rounded-xl px-2">
                <span
                    className="block size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: trackColor(track.color) }}
                />
                <span className="min-w-0 flex-1 truncate px-1 font-medium text-sm" title={track.name}>
                    {track.name}
                </span>
                <Button size="sm" variant={adding ? 'default' : 'outline'} onClick={actions.stopPointTool}>
                    {adding ? <CheckIcon /> : <XIcon />}
                    {adding ? 'Done' : 'Cancel'}
                </Button>
            </div>
            <div className="glass pointer-events-auto max-w-full truncate rounded-lg px-2.5 py-1 text-muted-foreground text-xs">
                {adding ? 'Click map to add points' : `Click map to move ${tool.point.name || 'the point'}`}
            </div>
        </div>
    );
}
