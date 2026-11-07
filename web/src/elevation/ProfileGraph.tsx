import { type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore, useAppStoreApi } from '@/state/context';
import type { ProfileData } from '@/state/store';
import { cursorInfo, profileSections } from './format';
import { distanceAt, gridValues, indexAtDistance, pointAt, SLOPE_CLASSES, slopeClass } from './profile';

// The profile graph is our own SVG (design add-web-elevation-profile, «График: свой SVG»): a polyline through the
// sample points above a fill of the sections in the color of the slope step (design slope-profile), the scale on the
// left, the cursor and the selection on top. The X axis is the distance, not the point index: at the segment ends the
// sample step is shorter. Mouse: a move sets the cursor, a press with a move makes a selection, a click removes the
// selection, a double click moves the map to this point, the wheel zooms 1–10× (the scroll is native). Finger (change
// profile-touch-gestures): a move sets the cursor, a long press and a move make a selection, a tap removes the
// selection, two fingers zoom 1–10× and scroll (the graph is touch-action: none, so the app scrolls it itself).

const PAD_TOP = 8;
const PAD_BOTTOM = 4;
const MAX_ZOOM = 10;
// the mouse move after which a press is a selection, not a click
const DRAG_THRESHOLD = 3;
// the long press that starts a finger selection: the same 500 ms as the long press of MapLibre (contextmenu on touch)
const LONG_PRESS_MS = 500;
// the finger move after which a press is not a long press and not a tap
const TOUCH_SLOP = 8;
// the smallest distance between two fingers in the zoom formula: fingers one above the other would divide by zero
const MIN_PINCH = 20;

// the gesture of one finger: where it went down and whether it moved, the long press timer, the selection mode
interface Press {
    x: number;
    index: number;
    moved: boolean;
    selecting: boolean;
    timer?: ReturnType<typeof setTimeout>;
}

interface Touches {
    // the fingers on the graph: pointerId → clientX
    points: Map<number, number>;
    press: Press | null;
    // the two-finger zoom: the distance between the fingers and the zoom at the start, and the point of the graph
    // between the fingers as a fraction of its width
    pinch: { distance: number; zoom: number; ratio: number } | null;
    // a second finger came: the fingers that stay do nothing until all fingers are up
    ended: boolean;
}

interface Size {
    width: number;
    height: number;
}

function useSize<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [size, setSize] = useState<Size>({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return [ref, size] as const;
}

interface Scale {
    grid: number[];
    y: (value: number) => number;
}

function scaleOf(values: readonly (number | null)[], height: number): Scale | null {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        if (value !== null) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
    }
    if (min > max) {
        return null;
    }
    const grid = gridValues(min, max);
    const low = grid[0];
    const high = grid[grid.length - 1];
    const span = height - PAD_TOP - PAD_BOTTOM;
    return { grid, y: (value) => PAD_TOP + ((high - value) / (high - low)) * span };
}

// Polyline: a run breaks at a point without data and at a joint of segments. Fill: by slope sections, one path per
// step: the sections break at the same places as the polyline (slopeSections).
function paths(data: ProfileData, width: number, height: number, scale: Scale) {
    const { distances, starts } = data.samples;
    const values = data.values ?? [];
    const first = distances[0];
    const total = distances[distances.length - 1] - first || 1;
    const x = (i: number) => (((distances[i] - first) / total) * (width - 1)).toFixed(1);
    const point = (i: number) => `${x(i)} ${scale.y(values[i] as number).toFixed(1)}`;
    const base = height - PAD_BOTTOM;
    const startSet = new Set(starts);
    const line: string[] = [];
    let run: string[] = [];
    const flush = () => {
        if (run.length > 1) {
            line.push(`M${run.join('L')}`);
        } else if (run.length === 1) {
            line.push(`M${run[0]}h0.5`);
        }
        run = [];
    };
    values.forEach((value, i) => {
        if (startSet.has(i)) {
            flush();
        }
        if (value === null) {
            flush();
            return;
        }
        run.push(point(i));
    });
    flush();
    const fills: string[][] = SLOPE_CLASSES.map(() => []);
    for (const section of profileSections(data)) {
        const outline: string[] = [];
        for (let i = section.from; i <= section.to; i++) {
            outline.push(point(i));
        }
        fills[slopeClass(section.grade)].push(
            `M${x(section.from)} ${base}L${outline.join('L')}L${x(section.to)} ${base}Z`,
        );
    }
    return { line: line.join(''), fills: fills.map((parts) => parts.join('')) };
}

export function ProfileGraph({ data }: { data: ProfileData }) {
    const store = useAppStoreApi();
    const cursor = useAppStore((state) => state.profileCursor);
    const selection = useAppStore((state) => state.profileSelection);
    const [frameRef, frame] = useSize<HTMLDivElement>();
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [zoom, setZoom] = useState(1);
    // the zoom and the scroll that are not in the DOM yet: two wheel events before a render count from them, not
    // from the old values
    const zoomRef = useRef(1);
    // the scroll after a zoom: the point below the mouse stays in place (onSvgMouseWheel of the old client)
    const pendingScroll = useRef<number | null>(null);
    const drag = useRef<{ start: number; x: number; moved: boolean } | null>(null);
    const touches = useRef<Touches>({ points: new Map(), press: null, pinch: null, ended: false });

    const width = Math.max(frame.width * zoom, 1);
    const height = frame.height;
    const values = data.values ?? [];
    const scale = useMemo(() => scaleOf(values, height), [values, height]);
    const drawn = useMemo(
        () => (scale && width > 1 ? paths(data, width, height, scale) : null),
        [data, width, height, scale],
    );

    const { distances } = data.samples;
    const first = distances[0];
    const total = distances[distances.length - 1] - first || 1;
    const xOf = (index: number) => ((distanceAt(distances, index) - first) / total) * (width - 1);

    function indexAt(clientX: number): number {
        const rect = contentRef.current?.getBoundingClientRect();
        const x = rect ? Math.min(Math.max(clientX - rect.left, 0), width - 1) : 0;
        return indexAtDistance(distances, first + (x / (width - 1)) * total);
    }

    useLayoutEffect(() => {
        if (pendingScroll.current !== null && scrollRef.current) {
            scrollRef.current.scrollLeft = pendingScroll.current;
            pendingScroll.current = null;
        }
    });

    // the wheel zooms horizontally; the listener is not passive (React adds wheel as passive), otherwise the page
    // does not let the code cancel the scroll
    useEffect(() => {
        const scroller = scrollRef.current;
        if (!scroller) {
            return;
        }
        function onWheel(event: WheelEvent) {
            // the horizontal scroll of a touchpad is native
            if (!scroller || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                return;
            }
            event.preventDefault();
            const old = zoomRef.current;
            const next = Math.min(Math.max(old + (event.deltaY < 0 ? 1 : -1), 1), MAX_ZOOM);
            if (next === old) {
                return;
            }
            const offset = event.clientX - scroller.getBoundingClientRect().left;
            const scrollLeft = pendingScroll.current ?? scroller.scrollLeft;
            const ratio = (scrollLeft + offset) / (scroller.clientWidth * old);
            pendingScroll.current = Math.max(ratio * scroller.clientWidth * next - offset, 0);
            zoomRef.current = next;
            setZoom(next);
        }
        scroller.addEventListener('wheel', onWheel, { passive: false });
        return () => scroller.removeEventListener('wheel', onWheel);
    }, []);

    useEffect(() => () => clearTimeout(touches.current.press?.timer), []);

    const state = () => store.getState();

    function onPointerDown(event: ReactPointerEvent) {
        if (event.pointerType !== 'mouse') {
            onTouchDown(event);
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { start: indexAt(event.clientX), x: event.clientX, moved: false };
    }

    function onPointerMove(event: ReactPointerEvent) {
        if (event.pointerType !== 'mouse') {
            onTouchMove(event);
            return;
        }
        const index = indexAt(event.clientX);
        state().setProfileCursor(index);
        const current = drag.current;
        if (!current) {
            return;
        }
        if (!current.moved && Math.abs(event.clientX - current.x) > DRAG_THRESHOLD) {
            current.moved = true;
        }
        if (current.moved) {
            state().setProfileSelection([Math.min(current.start, index), Math.max(current.start, index)]);
        }
    }

    function onPointerUp(event: ReactPointerEvent) {
        if (event.pointerType !== 'mouse') {
            onTouchUp(event);
            return;
        }
        const current = drag.current;
        drag.current = null;
        // a click without a move removes the selection (onSvgClick of the old client)
        if (current && !current.moved) {
            state().setProfileSelection(null);
        }
    }

    function onPointerCancel(event: ReactPointerEvent) {
        drag.current = null;
        const touch = touches.current;
        touch.points.delete(event.pointerId);
        clearTimeout(touch.press?.timer);
        touch.press = null;
        touch.pinch = null;
        touch.ended = touch.points.size > 0;
    }

    function onTouchDown(event: ReactPointerEvent) {
        const touch = touches.current;
        touch.points.set(event.pointerId, event.clientX);
        if (touch.points.size === 1) {
            const index = indexAt(event.clientX);
            state().setProfileCursor(index);
            const press: Press = { x: event.clientX, index, moved: false, selecting: false };
            // at the end of the long press the selection is the press point: the panel shows Selection at once
            press.timer = setTimeout(() => {
                press.selecting = true;
                state().setProfileSelection([index, index]);
            }, LONG_PRESS_MS);
            touch.ended = false;
            touch.press = press;
            return;
        }
        clearTimeout(touch.press?.timer);
        touch.press = null;
        touch.ended = true;
        if (touch.points.size === 2) {
            startPinch();
        }
    }

    function onTouchMove(event: ReactPointerEvent) {
        const touch = touches.current;
        // a pen above the screen moves without a press: only the cursor
        if (!touch.points.has(event.pointerId)) {
            state().setProfileCursor(indexAt(event.clientX));
            return;
        }
        touch.points.set(event.pointerId, event.clientX);
        if (touch.pinch) {
            movePinch();
            return;
        }
        const press = touch.press;
        if (!press || touch.ended) {
            return;
        }
        if (!press.moved && Math.abs(event.clientX - press.x) > TOUCH_SLOP) {
            press.moved = true;
            clearTimeout(press.timer);
        }
        const index = indexAt(event.clientX);
        state().setProfileCursor(index);
        if (press.selecting) {
            state().setProfileSelection([Math.min(press.index, index), Math.max(press.index, index)]);
        }
    }

    function onTouchUp(event: ReactPointerEvent) {
        const touch = touches.current;
        if (!touch.points.delete(event.pointerId)) {
            return;
        }
        if (touch.pinch) {
            touch.pinch = null;
            if (touch.points.size >= 2) {
                startPinch();
            }
            return;
        }
        const press = touch.press;
        touch.press = null;
        clearTimeout(press?.timer);
        // a tap and a long press without a move remove the selection, as a click of the mouse
        if (press && !touch.ended && !press.moved) {
            state().setProfileSelection(null);
        }
    }

    // the first two fingers on the graph: their horizontal distance and their middle
    function fingers() {
        const [a, b] = [...touches.current.points.values()];
        return { distance: Math.max(Math.abs(a - b), MIN_PINCH), middle: (a + b) / 2 };
    }

    function startPinch() {
        const scroller = scrollRef.current;
        if (!scroller) {
            return;
        }
        const { distance, middle } = fingers();
        const offset = middle - scroller.getBoundingClientRect().left;
        const scrollLeft = pendingScroll.current ?? scroller.scrollLeft;
        const zoom = zoomRef.current;
        touches.current.pinch = { distance, zoom, ratio: (scrollLeft + offset) / (scroller.clientWidth * zoom) };
    }

    // the zoom follows the distance between the fingers, and the scroll keeps the point of the graph from the start
    // of the pinch between the fingers: so a move of both fingers scrolls the graph
    function movePinch() {
        const scroller = scrollRef.current;
        const pinch = touches.current.pinch;
        if (!scroller || !pinch) {
            return;
        }
        const { distance, middle } = fingers();
        const next = Math.min(Math.max((pinch.zoom * distance) / pinch.distance, 1), MAX_ZOOM);
        const offset = middle - scroller.getBoundingClientRect().left;
        const scroll = Math.max(pinch.ratio * scroller.clientWidth * next - offset, 0);
        if (next === zoomRef.current) {
            scroller.scrollLeft = scroll;
            return;
        }
        pendingScroll.current = scroll;
        zoomRef.current = next;
        setZoom(next);
    }

    function onPointerLeave(event: ReactPointerEvent) {
        if (event.pointerType === 'mouse' && !drag.current) {
            state().setProfileCursor(null);
        }
    }

    function onDoubleClick(event: React.MouseEvent) {
        const point = pointAt(data.samples.points, indexAt(event.clientX));
        state().requestView({ lat: point.lat, lng: point.lng, zoom: state().view.zoom });
    }

    const info = cursor === null ? null : cursorInfo(data, cursor);
    const cursorX = cursor === null ? 0 : xOf(cursor);
    // the cursor label near the right edge goes on the left of the line
    const labelLeft = cursorX + 120 > (scrollRef.current?.scrollLeft ?? 0) + frame.width;

    return (
        <div className="flex h-full min-h-0 gap-1">
            <div className="relative w-9 shrink-0 text-[10px] text-muted-foreground tabular-nums" aria-hidden>
                {scale?.grid.map((value) => (
                    <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: scale.y(value) }}>
                        {value}
                    </span>
                ))}
            </div>
            <div ref={frameRef} className="relative min-w-0 flex-1">
                <div ref={scrollRef} className="absolute inset-0 overflow-x-auto overflow-y-hidden">
                    {/* biome-ignore lint/a11y/noStaticElementInteractions: the graph is for mouse and finger, as in
                        the old client; the profile numbers are available as text in the summary */}
                    <div
                        ref={contentRef}
                        className="relative h-full touch-none select-none [-webkit-touch-callout:none]"
                        style={{ width }}
                        data-testid="profile-graph"
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerCancel}
                        // the long press of a finger: no context menu of the browser over the graph
                        onContextMenu={(event) => {
                            if (touches.current.points.size > 0) {
                                event.preventDefault();
                            }
                        }}
                        onPointerLeave={onPointerLeave}
                        onDoubleClick={onDoubleClick}
                    >
                        <svg width={width} height={height} className="absolute inset-0" aria-hidden>
                            {scale?.grid.map((value) => (
                                <line
                                    key={value}
                                    x1={0}
                                    x2={width}
                                    y1={Math.round(scale.y(value)) + 0.5}
                                    y2={Math.round(scale.y(value)) + 0.5}
                                    className="stroke-border"
                                />
                            ))}
                            {drawn && (
                                <>
                                    {drawn.fills.map((d, step) => (
                                        <path
                                            // biome-ignore lint/suspicious/noArrayIndexKey: the steps do not change
                                            key={step}
                                            d={d}
                                            className={SLOPE_CLASSES[step].fill}
                                            data-slope={step}
                                        />
                                    ))}
                                    <path
                                        d={drawn.line}
                                        className="fill-none stroke-foreground/75"
                                        strokeWidth={1.5}
                                        strokeLinejoin="round"
                                        data-testid="profile-line"
                                    />
                                </>
                            )}
                        </svg>
                        {/* the selection dims the graph around it: the step colors inside stay true (design
                            slope-profile, «Выделение») */}
                        {selection && (
                            <>
                                <div
                                    className="pointer-events-none absolute inset-y-0 left-0 bg-background/65"
                                    style={{ width: xOf(selection[0]) }}
                                    data-testid="profile-dim"
                                />
                                <div
                                    className="pointer-events-none absolute inset-y-0 right-0 bg-background/65"
                                    style={{ left: xOf(selection[1]) }}
                                    data-testid="profile-dim"
                                />
                                <div
                                    className="pointer-events-none absolute inset-y-0 border-foreground/50 border-x"
                                    style={{
                                        left: xOf(selection[0]),
                                        width: Math.max(xOf(selection[1]) - xOf(selection[0]), 1),
                                    }}
                                    data-testid="profile-selection"
                                />
                            </>
                        )}
                        {info && (
                            <>
                                <div
                                    className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
                                    style={{ left: cursorX }}
                                    data-testid="profile-cursor"
                                />
                                <div
                                    className={`pointer-events-none absolute top-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[11px] leading-tight tabular-nums shadow-sm ring-1 ring-foreground/10 ${labelLeft ? '-translate-x-full' : ''}`}
                                    style={{ left: labelLeft ? cursorX - 6 : cursorX + 6 }}
                                    data-testid="profile-cursor-label"
                                >
                                    <div className="font-medium">{info.elevation}</div>
                                    <div>{info.distance}</div>
                                    <div>{info.slope}</div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
