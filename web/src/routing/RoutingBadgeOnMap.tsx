import { useMap } from '@vis.gl/react-maplibre';
import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/state/context';
import { tracksRouting } from './line';
import { RouteThread } from './RouteThread';

// The routing wait badge at the mouse pointer (spec route-editing, «Бейдж ожидания у указателя»; design
// route-thread-loader). Browsers do not animate a cursor image (the first frame of GIF, APNG and SVG), so the badge is
// an element over the map, and the cursor stays as it is: the drawing crosshair, move over a waypoint. The pointer:
// mouse Pointer Events only: after a touch the browser sends compatibility mousemove events, and the badge would stay
// under the finger. The canvas pointerleave also fires over panels, markers and controls: they are not canvas children.
// The code writes the position to the style past React, and clicks go through the badge to the map.

// the badge top left corner from the arrow tip, px: right of and below the arrow, at the wheel of the progress cursor
const OFFSET = { x: 12, y: 16 };

const badgeTransform = ({ x, y }: { x: number; y: number }) => `translate(${x + OFFSET.x}px, ${y + OFFSET.y}px)`;

export function RoutingBadgeOnMap() {
    const { current } = useMap();
    const map = current?.getMap();
    const routing = useAppStore((state) => tracksRouting(state.tracks));
    const [over, setOver] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    // the tip in map container coordinates: the badge appears on a router response, when the mouse already stands still
    const at = useRef({ x: 0, y: 0 });

    useEffect(() => {
        if (!map) {
            return;
        }
        const canvas = map.getCanvas();
        const onPointer = (event: PointerEvent) => {
            if (event.pointerType !== 'mouse') {
                setOver(false);
                return;
            }
            const rect = map.getContainer().getBoundingClientRect();
            at.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            ref.current?.style.setProperty('transform', badgeTransform(at.current));
            setOver(true);
        };
        const onLeave = () => setOver(false);
        canvas.addEventListener('pointermove', onPointer);
        canvas.addEventListener('pointerdown', onPointer);
        canvas.addEventListener('pointerleave', onLeave);
        return () => {
            canvas.removeEventListener('pointermove', onPointer);
            canvas.removeEventListener('pointerdown', onPointer);
            canvas.removeEventListener('pointerleave', onLeave);
        };
    }, [map]);

    if (!routing || !over) {
        return null;
    }
    // the position at appearance comes from the last move, then onPointer writes it. 27 px is ×1.5 of the first 18 px:
    // the owner chose it on 2026-10-30 from a size sheet on the live map (at 18 the thread is almost invisible, 36 is
    // as the round buttons and covers the place of the next point)
    return (
        <div
            ref={ref}
            className="pointer-events-none absolute top-0 left-0 z-10 size-[27px]"
            style={{ transform: badgeTransform(at.current) }}
            data-testid="routing-badge"
        >
            <RouteThread variant="badge" />
        </div>
    );
}
