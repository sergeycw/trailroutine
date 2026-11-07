import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { type Hsv, hexToHsv, hsvToHex, parseHex } from './color';

// Custom color picker under the palette (design track-color-picker, «Пикер: своя вёрстка»): a saturation and value
// square, a hue bar, a hex field. The state is HSV, not hex: otherwise the hue would be lost on black and gray. The
// color goes out (onCommit) at the end of a drag, on an arrow key release and on hex input: while the user drags or
// holds an arrow key, only the handle, the sample and the field change, because each track change builds the GeoJSON
// of all tracks again and writes autosave. A color that is shown but not applied (a typed hex without Enter) goes to
// onDraft: the palette applies it on close.

const HUE_GRADIENT = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';

function clamp(value: number, max: number): number {
    return Math.min(max, Math.max(0, value));
}

// Fraction 0–1 of the pointer position in the element on each axis
function fraction(event: PointerEvent<HTMLElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
        x: clamp((event.clientX - rect.left) / rect.width, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 1),
    };
}

// Drag with a mouse and a finger with one code: pointer capture keeps the movement when the pointer goes outside the
// element and past the popover edge. The capture can fail (the pointer is no longer active) or get lost: then the end
// comes on lostpointercapture or on the first movement without a pressed button, otherwise the color would follow the
// mouse without a press.
function useDrag(move: (event: PointerEvent<HTMLElement>) => void, end: () => void) {
    const dragging = useRef(false);
    const finish = () => {
        if (!dragging.current) {
            return;
        }
        dragging.current = false;
        end();
    };
    return {
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
            if (event.button !== 0) {
                return;
            }
            dragging.current = true;
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // the pointer is not active: no capture
            }
            move(event);
        },
        onPointerMove: (event: PointerEvent<HTMLElement>) => {
            if (!dragging.current) {
                return;
            }
            if (event.buttons === 0) {
                finish();
                return;
            }
            move(event);
        },
        onPointerUp: finish,
        onPointerCancel: finish,
        onLostPointerCapture: finish,
    };
}

// Arrow step is 1, with Shift 10; null means the key is not an arrow
function arrowStep(event: KeyboardEvent): { x: number; y: number } | null {
    const step = event.shiftKey ? 10 : 1;
    const steps: Record<string, { x: number; y: number }> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: step },
        ArrowDown: { x: 0, y: -step },
    };
    return steps[event.key] ?? null;
}

export function HsvPicker({
    color,
    onCommit,
    onDraft,
}: {
    color: string;
    onCommit: (hex: string) => void;
    // the color that the picker shows but did not apply yet; null means there is nothing to apply
    onDraft: (hex: string | null) => void;
}) {
    const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color));
    const [text, setText] = useState(color);
    const [source, setSource] = useState(color);
    const latest = useRef(hsv);
    // the track color changed from outside (a preset color, another track): the picker moves to it; the picker's own
    // applied color does not change HSV, otherwise the hue of black or gray would reset
    if (source !== color) {
        setSource(color);
        setText(color);
        if (hsvToHex(latest.current) !== color) {
            latest.current = hexToHsv(color);
            setHsv(latest.current);
        }
    }

    const show = (next: Hsv) => {
        latest.current = next;
        setHsv(next);
        setText(hsvToHex(next));
        onDraft(hsvToHex(next));
    };
    const commit = () => {
        onDraft(null);
        onCommit(hsvToHex(latest.current));
    };

    const area = useDrag((event) => {
        const { x, y } = fraction(event);
        show({ ...latest.current, s: x * 100, v: (1 - y) * 100 });
    }, commit);
    const hue = useDrag((event) => show({ ...latest.current, h: fraction(event).x * 360 }), commit);

    const onAreaKey = (event: KeyboardEvent) => {
        const step = arrowStep(event);
        if (!step) {
            return;
        }
        event.preventDefault();
        show({ ...latest.current, s: clamp(latest.current.s + step.x, 100), v: clamp(latest.current.v + step.y, 100) });
    };
    const onHueKey = (event: KeyboardEvent) => {
        const step = arrowStep(event);
        if (!step) {
            return;
        }
        event.preventDefault();
        show({ ...latest.current, h: clamp(latest.current.h + step.x + step.y, 360) });
    };
    // the key release applies the arrow step: holding with auto-repeat does not write the track on each step
    const onArrowUp = (event: KeyboardEvent) => {
        if (arrowStep(event)) {
            commit();
        }
    };

    // An invalid hex on Enter or on leaving the field brings back the track color
    const commitText = () => {
        const hex = parseHex(text);
        if (!hex) {
            latest.current = hexToHsv(color);
            setHsv(latest.current);
            setText(color);
            onDraft(null);
            return;
        }
        if (hex !== hsvToHex(latest.current)) {
            latest.current = hexToHsv(hex);
            setHsv(latest.current);
        }
        setText(hex);
        onDraft(null);
        onCommit(hex);
    };

    const current = hsvToHex(hsv);
    return (
        <div className="flex flex-col gap-2">
            <div
                role="slider"
                tabIndex={0}
                aria-label="Saturation and brightness"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(hsv.s)}
                aria-valuetext={`Saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`}
                className="relative h-30 w-full cursor-crosshair touch-none select-none rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                style={{
                    background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
                }}
                onKeyDown={onAreaKey}
                onKeyUp={onArrowUp}
                {...area}
            >
                <span
                    className="pointer-events-none absolute size-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
                    style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: current }}
                />
            </div>
            {/* the bar is 14 px, but the press area is 24 px high: a thin bar is hard to hit with a finger */}
            <div
                role="slider"
                tabIndex={0}
                aria-label="Hue"
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(hsv.h)}
                className="relative mx-2 flex h-6 cursor-pointer touch-none select-none items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onKeyDown={onHueKey}
                onKeyUp={onArrowUp}
                {...hue}
            >
                <span
                    className="pointer-events-none block h-3.5 w-full rounded-full"
                    style={{ background: HUE_GRADIENT }}
                />
                <span
                    className="pointer-events-none absolute top-1/2 size-4.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.3)]"
                    style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
                />
            </div>
            <div className="flex items-center gap-2">
                <span
                    className="block size-7 shrink-0 rounded-md border border-black/10"
                    style={{ backgroundColor: current }}
                />
                <Input
                    aria-label="Hex color"
                    className="h-7 font-mono"
                    value={text}
                    maxLength={7}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                        setText(event.target.value);
                        const hex = parseHex(event.target.value);
                        onDraft(hex);
                        if (hex) {
                            latest.current = hexToHsv(hex);
                            setHsv(latest.current);
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            commitText();
                        }
                    }}
                    onBlur={commitText}
                />
            </div>
        </div>
    );
}
