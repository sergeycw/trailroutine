import { ChevronDownIcon, FlameIcon, SatelliteIcon } from 'lucide-react';
import { type ComponentType, type RefObject, useEffect, useRef } from 'react';
import { ROUND_BUTTON } from '@/components/round-button';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/state/context';
import { savedSelection } from '@/state/store';
import type { LayerDef } from './catalog';
import { QUICK_BASE_GROUPS, QUICK_OVERLAY_GROUPS, type QuickLayerGroup, quickTarget } from './quick-layers';
import { DEFAULT_SELECTION } from './selection';
import { isListed, type LayerSettings } from './settings';

// Quick layers on the right (design layer-thumbnails, design three-quick-bases, design quick-layer-menus): three
// basemap circles by type and the Strava heatmap button, each with the menu of its group under its badge. The full list
// is the All layers button in LayerSwitcher.

// Overlay button icons by the first code of a group in QUICK_OVERLAY_GROUPS. Icons instead of previews: overlay tiles
// are transparent
const OVERLAY_ICONS: Record<string, ComponentType> = { Sa: FlameIcon };

// Images from the build (scripts/layer-thumbnails.mjs): the app does not request tiles for the previews. Vite puts
// files smaller than 4 KB into the bundle (assetsInlineLimit)
const THUMBNAILS = import.meta.glob<string>('./thumbnails/*.webp', { eager: true, import: 'default' });

function thumbnailOf(code: string): string | undefined {
    return THUMBNAILS[`./thumbnails/${code}.webp`];
}

// A round button inside a MapLibre control: its CSS outside @layer sets the background rgba(0, 0, 0, 0.05) on
// .maplibregl-ctrl button on hover and on press, and overrides the hover of ROUND_BUTTON, hence the !
export const COLUMN_BUTTON = cn(ROUND_BUTTON, 'hover:bg-white/90! active:bg-white/90!');

// Pressed buttons have the --primary fill, as Street View (MapButtons); the hover of a ghost button darkens the icon,
// so a pressed button has its own hover
const PRESSED =
    'bg-primary! text-primary-foreground hover:bg-primary/90! hover:text-primary-foreground active:bg-primary/90!';

// The menu badge is its own Button at the bottom left edge of the circle, as the badge on a Telegram avatar (owner
// reference 2026-10-29, on the menu side): the circle and the menu have different actions and names. The look (owner
// 2026-10-29, design quick-circle-contrast): dark gray with a white arrow and a white outline, which cuts the badge out
// of the circle ring. Glass was not visible on a light map, and a badge ring over the circle ring gave two crossing
// circles. The visible part of 16 px is half outside the circle edge: the column padding for it is pl-2.5 in
// LayerSwitcher. The touch area (after) is 4 px wider: downward, it does not reach the next circle (gap-y-2). bg with
// !: the MapLibre CSS outside @layer darkens the background of .maplibregl-ctrl buttons
const MENU_BADGE = cn(
    'pointer-events-auto absolute -bottom-0.5 -left-1.5 size-4 rounded-full border-2 border-white text-white',
    'bg-neutral-700! hover:bg-neutral-600! active:bg-neutral-600! aria-expanded:bg-neutral-600!',
    'after:absolute after:-inset-1',
);

// The ring and the shadow of a basemap circle (owner 2026-10-29, variant C, design quick-circle-contrast): without
// them, a light preview (Google Map) merged with a light map. The shadow is not wider than the column padding (py-1,
// pr-1 in LayerSwitcher): otherwise the overflow-hidden of the column would cut it with a step. With !: glass sets its
// own shadow
const CIRCLE_RING = 'shadow-[0_0_0_1.5px_rgb(0_0_0/0.45),0_1px_4px_rgb(0_0_0/0.35)]!';

// Menu items of a group: no layer that is unchecked in Configure layers (the check box of a group layer is on by
// default, listedByDefault), except the layer that is on the map now and the first layer of the group, which is the
// circle itself
function menuItems(
    group: QuickLayerGroup,
    layers: ReadonlyMap<string, LayerDef>,
    settings: LayerSettings,
    current: string | undefined,
): LayerDef[] {
    return group.codes.flatMap((code) => {
        const layer = layers.get(code);
        const shown = layer && (code === group.codes[0] || code === current || isListed(layer, settings));
        return shown ? [layer] : [];
    });
}

interface QuickMenuProps {
    group: QuickLayerGroup;
    // the circle: the menu aligns its top with the circle, not with the badge
    anchor: RefObject<HTMLDivElement | null>;
    items: LayerDef[];
    current: string | undefined;
    onSelect(code: string): void;
}

function QuickMenu({ group, anchor, items, current, onSelect }: QuickMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button size="icon-xs" className={MENU_BADGE} aria-label={group.name} title={group.name} />}
            >
                <ChevronDownIcon className="size-2.5 stroke-3" />
            </DropdownMenuTrigger>
            {/* to the left of the circle: the column is at the right edge, as All layers */}
            <DropdownMenuContent side="left" align="start" anchor={anchor} className="w-auto" aria-label={group.name}>
                {/* '' — nothing in the group is on: no item has a mark */}
                <DropdownMenuRadioGroup value={current ?? ''} onValueChange={(code) => onSelect(String(code))}>
                    {items.map((layer) => (
                        // a Base UI RadioItem does not close the menu by default
                        <DropdownMenuRadioItem key={layer.code} value={layer.code} closeOnClick>
                            {layer.title}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

// The three circles are always the same types QUICK_BASE_GROUPS (owner 2026-10-28), even if Configure layers hides the
// basemap of a circle: this is a column function, as QuickDated. There are no labels: the previews show the type and
// differ by image. A circle is a type, not a basemap (owner 2026-10-29, design quick-layer-menus): the image is of the
// first basemap of the group, the circle is marked for any basemap of the group, and a click selects the last selected
// basemap of the group (quickTarget)
export function QuickBases() {
    return QUICK_BASE_GROUPS.map((group) => <QuickBase key={group.codes[0]} group={group} />);
}

function QuickBase({ group }: { group: QuickLayerGroup }) {
    const layers = useAppStore((state) => state.layers);
    const settings = useAppStore((state) => state.settings);
    const selected = useAppStore((state) => state.selection.base);
    // the user selection: during a basemap fallback (Of → Tt), the map shows the fallback basemap, and the selection is
    // the basemap that the fallback started from
    const chosen = useAppStore((state) => savedSelection(state).base);
    const selectBase = useAppStore((state) => state.selectBase);
    const circle = useRef<HTMLDivElement>(null);
    const main = layers.get(group.codes[0]);
    if (!main) {
        return null;
    }
    const current = group.codes.includes(selected) ? selected : undefined;
    const items = menuItems(group, layers, settings, current);
    // the click target is the user selection, not the fallback basemap: otherwise a click on the marked topo map circle
    // during the OpenFreeMap fallback would record Tracestrack as the selection and would continue to spend its quota
    // (diff review of openfreemap-default-basemap)
    const target = quickTarget(
        group,
        settings.quickLayers,
        group.codes.includes(chosen) ? chosen : current,
        items.map((layer) => layer.code),
    );
    const title = layers.get(target)?.title ?? main.title;
    return (
        <div ref={circle} className="relative">
            <Button
                variant="ghost"
                size="icon-lg"
                className={cn(
                    COLUMN_BUTTON,
                    CIRCLE_RING,
                    'overflow-hidden p-0',
                    // outline-solid: Button has outline-none, and cn replaces it only with the same property
                    current && 'outline-solid outline-2 outline-primary outline-offset-2',
                )}
                aria-label={title}
                title={title}
                aria-pressed={current !== undefined}
                onClick={() => selectBase(target)}
            >
                {/* no pointer: otherwise the mouse drags the image, and the click does not reach the button */}
                <img
                    src={thumbnailOf(main.code)}
                    alt=""
                    draggable={false}
                    className="pointer-events-none size-full object-cover"
                />
            </Button>
            <QuickMenu group={group} anchor={circle} items={items} current={current} onSelect={selectBase} />
        </div>
    );
}

// The overlay button is like a basemap circle (design quick-layer-menus): it turns on the group layer that was selected
// last and turns off the group; the menu under the badge puts another group layer on the map instead of the previous
// one. The group layers have no other place (they are not in All layers, design custom-bases-in-list), so the button is
// always present, as the circles
export function QuickOverlays() {
    return QUICK_OVERLAY_GROUPS.map((group) => <QuickOverlay key={group.codes[0]} group={group} />);
}

function QuickOverlay({ group }: { group: QuickLayerGroup }) {
    const layers = useAppStore((state) => state.layers);
    const settings = useAppStore((state) => state.settings);
    const enabled = useAppStore((state) => state.selection.overlays);
    const setQuickOverlay = useAppStore((state) => state.setQuickOverlay);
    const circle = useRef<HTMLDivElement>(null);
    const main = layers.get(group.codes[0]);
    const Icon = OVERLAY_ICONS[group.codes[0]];
    if (!main || !Icon) {
        return null;
    }
    const current = group.codes.find((code) => enabled.includes(code));
    const items = menuItems(group, layers, settings, current);
    const target = quickTarget(
        group,
        settings.quickLayers,
        current,
        items.map((layer) => layer.code),
    );
    const title = layers.get(target)?.title ?? main.title;
    return (
        <div ref={circle} className="relative">
            <Button
                variant="ghost"
                size="icon-lg"
                className={cn(COLUMN_BUTTON, current && PRESSED)}
                aria-label={title}
                title={title}
                aria-pressed={current !== undefined}
                onClick={() => setQuickOverlay(group, current ? null : target)}
            >
                <Icon />
            </Button>
            <QuickMenu
                group={group}
                anchor={circle}
                items={items}
                current={current}
                onSelect={(code) => setQuickOverlay(group, code)}
            />
        </div>
    );
}

// Dated imagery has its own button under the previews (owner 2026-10-12, design quick-dated-imagery): a click selects
// it, the next click returns the basemap that was selected before it, or, without one (a link with l=Hls at once), the
// default basemap. The button is present even if Configure layers hides the layer: it is a function, not a list row
export function QuickDated() {
    const layers = useAppStore((state) => state.layers);
    const selected = useAppStore((state) => state.selection.base);
    // after the fallback from Tracestrack to OSM, return to Tracestrack: a fallback is not a selection and must not go
    // into the circle memory
    const chosen = useAppStore((state) => savedSelection(state).base);
    const selectBase = useAppStore((state) => state.selectBase);
    const lastBase = useRef<string | null>(null);
    const dated = [...layers.values()].find((layer) => layer.dated);
    const active = dated !== undefined && selected === dated.code;
    useEffect(() => {
        if (!layers.get(selected)?.dated) {
            lastBase.current = chosen;
        }
    }, [layers, selected, chosen]);
    if (!dated) {
        return null;
    }
    return (
        <Button
            variant="ghost"
            size="icon-lg"
            className={cn(COLUMN_BUTTON, active && PRESSED)}
            aria-label={dated.title}
            title={dated.title}
            aria-pressed={active}
            onClick={() => {
                if (!active) {
                    selectBase(dated.code);
                    return;
                }
                // the previous basemap can be gone (a deleted custom layer): then the default basemap
                const previous = lastBase.current;
                selectBase(previous && layers.has(previous) ? previous : DEFAULT_SELECTION.base);
            }}
        >
            <SatelliteIcon />
        </Button>
    );
}
