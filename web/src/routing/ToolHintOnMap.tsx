import { useMap } from '@vis.gl/react-maplibre';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@/state/context';
import { toolOrigin } from './line-tools';
import { nearTo } from './MapEditor';

// The hint for the Join and Shortcut choice at the point that the choice starts from (mock-up 4a, design
// editor-hint-at-point): above the point, or below it if there is not enough space above. If the point is outside the
// map edge (the user moves the map to find the target), the hint stays at the edge of the visible part and does not
// disappear. Clicks go through the hint to the map: under it there can be a line that the user clicks. The position
// goes to the style on each map move and size change, past React.

// the gap between the point and the hint, px
const GAP = 12;
// margins of the visible part: at the top, the editor row (top-3 in TopBar.tsx + h-11 in EditPanel.tsx; over the full
// width, although the row is only on the left), at the right, the control column, at the bottom, the profile button and
// the scale bar above the bottom panels (--bottom-inset)
const INSET = { top: 64, right: 56, bottom: 60, left: 8 };

export function ToolHintOnMap() {
    const { current } = useMap();
    const map = current?.getMap();
    const tool = useAppStore((state) => state.lineTool);
    const line = useAppStore((state) => state.routeEdit?.line);
    // Shortcut mid-link gives a new projection point on each call: without memo, the effect would rerun on each render
    const origin = useMemo(() => (tool && line ? toolOrigin(line, tool) : null), [tool, line]);
    const ref = useRef<HTMLDivElement>(null);
    // bottom panel height in px: --bottom-inset is a calc(…) string, getPropertyValue returns it as text, not a number
    const probe = useRef<HTMLDivElement>(null);

    // before the paint: otherwise, for one frame, the hint stands in the map corner
    useLayoutEffect(() => {
        const node = ref.current;
        const inset = probe.current;
        if (!map || !node || !inset || !origin) {
            return;
        }
        const place = () => {
            // the world copy near the view center: a point from a neighbor copy would go outside the edge
            const center = map.getCenter();
            const at = nearTo(origin, { lat: center.lat, lng: center.lng });
            const point = map.project([at.lng, at.lat]);
            const container = map.getContainer();
            const width = node.offsetWidth;
            const height = node.offsetHeight;
            const maxX = container.clientWidth - INSET.right - width;
            const maxY = container.clientHeight - inset.offsetHeight - INSET.bottom - height;
            const above = point.y - GAP - height;
            const y = above >= INSET.top ? above : point.y + GAP;
            const x = point.x - width / 2;
            node.style.transform = `translate(${clamp(x, INSET.left, maxX)}px, ${clamp(y, INSET.top, maxY)}px)`;
        };
        place();
        map.on('move', place);
        map.on('resize', place);
        // the hint box width (a font loaded) and the bottom panels (the profile opened) change without a map move
        const observer = new ResizeObserver(place);
        observer.observe(node);
        observer.observe(inset);
        return () => {
            map.off('move', place);
            map.off('resize', place);
            observer.disconnect();
        };
    }, [map, origin]);

    if (!tool || !origin) {
        return null;
    }
    const hint = tool.kind === 'join' ? 'Click a track line to join it' : 'Click the line where the shortcut ends';
    // font-sans: inside the map, the font from the MapLibre CSS applies
    return (
        <>
            <div ref={probe} className="pointer-events-none invisible absolute bottom-0 h-(--bottom-inset)" />
            <div
                ref={ref}
                className="glass pointer-events-none absolute top-0 left-0 z-10 max-w-[calc(100%-64px)] truncate rounded-lg px-2.5 py-1 font-medium font-sans text-xs"
                data-testid="tool-hint"
            >
                {hint}
            </div>
        </>
    );
}

// a window narrower than the hint (max < min) takes min: the hint stays at the left or top margin, not outside the edge
function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(value, max));
}
