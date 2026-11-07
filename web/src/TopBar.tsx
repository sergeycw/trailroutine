import { PlusIcon, RulerIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ROUND_BUTTON } from '@/components/round-button';
import { Button } from '@/components/ui/button';
import { config } from '@/config';
import { cn } from '@/lib/utils';
import { EditPanel } from '@/routing/EditPanel';
import { useRouteEditing } from '@/routing/editing-context';
import { SearchBox } from '@/search/SearchBox';
import { useAppStore } from '@/state/context';
import { PointPanel } from '@/tracks/PointPanel';
import { TrackList, TracksButton } from '@/tracks/TrackList';

// «Measure distance»: a track Ruler with distance ticks, and the drawing starts at once (control-ruler.js of the old
// client)
function RulerButton() {
    const editing = useRouteEditing();
    return (
        <Button
            variant="ghost"
            size="icon-lg"
            className={ROUND_BUTTON}
            aria-label="Measure distance"
            title="Measure distance"
            onClick={() => editing.newTrack('Ruler', { measureTicksShown: true })}
        >
            <RulerIcon />
        </Button>
    );
}

// The route zone at the top left (three zones, design layout-three-zones): the search capsule, the round Tracks, New
// and the ruler. While a line is in edit or the user places track points, the bar becomes their panel. The track list
// is a panel below the bar: the Tracks button opens it, and the same button or a press on the map (the MapLibre
// canvas) closes it, not any click outside: the menus and dialogs of the list live in portals outside the panel.
export function TopBar({ fetch }: { fetch: typeof window.fetch }) {
    const editing = useRouteEditing();
    const lineEdited = useAppStore((state) => state.routeEdit !== null);
    const pointMode = useAppStore((state) => state.pointTool !== null);
    const [tracksOpen, setTracksOpen] = useState(false);

    useEffect(() => {
        if (!tracksOpen) {
            return;
        }
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Element && event.target.closest('.maplibregl-canvas')) {
                setTracksOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [tracksOpen]);

    let bar = (
        // each button is its own glass, and the gaps between them show the map (design layout-three-zones,
        // «Зоны и компоненты»)
        <div className="flex w-full items-center gap-1">
            {/* relative z-20: the glass has its own stacking context (backdrop-filter), and without it the open list
                below the bar would draw above the search results */}
            <div
                className="glass pointer-events-auto relative z-20 flex h-9 min-w-0 flex-1 items-center rounded-full"
                data-testid="search-bar"
            >
                <SearchBox sources={{ fetch, corsProxyUrl: config.corsProxyUrl }} />
            </div>
            <TracksButton open={tracksOpen} onToggle={() => setTracksOpen(!tracksOpen)} />
            <Button
                variant="ghost"
                size="icon-lg"
                // the accent of the main button (mock-up 4a) is the icon color: the button stays glass, as the buttons
                // next to it
                className={cn(ROUND_BUTTON, 'text-primary hover:text-primary')}
                aria-label="New track"
                title="New track"
                onClick={() => editing.newTrack('')}
            >
                <PlusIcon />
            </Button>
            <RulerButton />
        </div>
    );
    if (lineEdited) {
        bar = <EditPanel />;
    } else if (pointMode) {
        bar = <PointPanel />;
    }

    return (
        // on the right, space for the column of map buttons (4.5rem = margins + button); at the bottom, above the
        // profile button and the bottom panels (--bottom-inset); clicks between the panels go to the map
        <div
            className="pointer-events-none absolute top-3 left-3 z-10 flex max-h-[calc(100dvh-5rem-var(--bottom-inset))] w-[min(30rem,calc(100vw-4.5rem))] flex-col items-start gap-2"
            data-testid="top-bar"
        >
            {bar}
            {tracksOpen && <TrackList />}
        </div>
    );
}
