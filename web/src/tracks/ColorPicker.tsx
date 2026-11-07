import { type RefObject, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTrackActions } from './actions-context';
import { normalizeColor } from './color';
import { HsvPicker } from './HsvPicker';
import { TRACK_COLORS, type Track, type TrackColor, trackColor } from './model';
import { readRecentColors, rememberColor } from './recent-colors';

// Track color palette: a row of the track list and a row of the line editor (design editor-row-cleanup,
// «Палитра одна на список и редактор»). A list that was open before editing started stays until the first press on
// the map: then the screen has two `Color of <name>` buttons, and the editor tests look for theirs inside edit-panel.
// A color change changes only the color field and does not stop the line editing. The color row has recent custom
// colors and preset colors, the picker is under it (design track-color-picker): a color from the row closes the
// palette, a custom one from the picker does not, because the user adjusts it in several movements.
export function ColorPicker({ track }: { track: Track }) {
    const [open, setOpen] = useState(false);
    const popup = useRef<HTMLDivElement>(null);
    const selected = useRef<HTMLButtonElement>(null);
    // Focus on open (design palette-one-row): with a mouse and a finger, on the popup itself, without a ring on the
    // color button (the ring of the first button looked like the selected color); with a keyboard, on the selected
    // color of the row, otherwise as in Base UI. The focus does not stay on the trigger button: Escape there would
    // reach the line editor, but the editor skips the popup (role="dialog").
    const initialFocus = (type: string) => (type === 'keyboard' ? (selected.current ?? true) : popup.current);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                render={
                    <Button variant="ghost" size="icon-xs" aria-label={`Color of ${track.name}`} className="shrink-0" />
                }
            >
                <span
                    className="block h-1.5 w-4 rounded-full"
                    style={{ backgroundColor: trackColor(track.color) }}
                    data-color={track.color}
                />
            </PopoverTrigger>
            <PopoverContent
                ref={popup}
                initialFocus={initialFocus}
                side="bottom"
                align="start"
                className="w-52 gap-2 p-2"
            >
                <Palette track={track} close={() => setOpen(false)} selected={selected} />
            </PopoverContent>
        </Popover>
    );
}

// Content of the open palette: it mounts on each open, and recent colors are read at the same time. While the
// palette is open, the color row does not change: a new recent color would move the preset colors under the finger.
// On close (any close, Escape too), the picker color that is shown but not applied is applied: a typed hex without
// Enter (what the sample shows, the track gets). Only one color goes to the recent colors: the last custom color
// applied during this open. Otherwise arrows and short drags would push out the recent colors with almost equal hues.
function Palette({
    track,
    close,
    selected,
}: {
    track: Track;
    close: () => void;
    selected: RefObject<HTMLButtonElement | null>;
}) {
    const actions = useTrackActions();
    const [recent] = useState(readRecentColors);
    // the track at the moment of close: the close effect sees the closure of the first render
    const current = useRef(track);
    current.current = track;
    const draft = useRef<string | null>(null);
    const applied = useRef<string | null>(null);
    const choose = (color: TrackColor) => {
        draft.current = null;
        if (typeof color === 'string') {
            applied.current = color;
        }
        if (color !== current.current.color) {
            actions.setColor(current.current, color);
        }
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: only on close, choose reads refs
    useEffect(
        () => () => {
            if (draft.current) {
                choose(normalizeColor(draft.current));
            }
            if (applied.current) {
                rememberColor(applied.current);
            }
        },
        [],
    );
    // one row of six (design palette-one-row): recent custom colors on the left, then preset colors in order, extra
    // preset colors on the right are not visible; the preset color number in the label does not depend on its place in
    // the row. A selected preset color that fell out of the row (the color cycle gives red, pink, yellow to the 4th–6th
    // track) goes last: a row without the selected color was confusing.
    const presets = TRACK_COLORS.map((color, index) => ({
        color,
        value: index as TrackColor,
        label: `Color ${index + 1}`,
    }));
    const row = [
        ...recent.map((color) => ({ color, value: color as TrackColor, label: `Recent color ${color}` })),
        ...presets,
    ].slice(0, TRACK_COLORS.length);
    const hidden = presets.find((item) => item.value === track.color && !row.includes(item));
    if (hidden) {
        row[row.length - 1] = hidden;
    }
    const swatch = (color: string) => (
        <span className="block h-1.5 w-4 rounded-full" style={{ backgroundColor: color }} />
    );
    return (
        <>
            <div className="flex justify-between">
                {row.map(({ color, value, label }) => (
                    <Button
                        key={label}
                        ref={value === track.color ? selected : undefined}
                        variant={value === track.color ? 'outline' : 'ghost'}
                        size="icon-sm"
                        aria-label={label}
                        onClick={() => {
                            choose(value);
                            close();
                        }}
                    >
                        {swatch(color)}
                    </Button>
                ))}
            </div>
            <HsvPicker
                color={trackColor(track.color)}
                onCommit={(hex) => choose(normalizeColor(hex))}
                onDraft={(hex) => {
                    draft.current = hex;
                }}
            />
        </>
    );
}
