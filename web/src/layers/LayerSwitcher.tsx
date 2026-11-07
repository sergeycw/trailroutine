import { LayersIcon, PencilIcon, PlusIcon, Settings2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ControlPortal } from '@/map/control-portal';
import { useAppStore } from '@/state/context';
import { ConfigureLayersDialog } from './ConfigureLayersDialog';
import { CustomLayerDialog } from './CustomLayerDialog';
import { GROUPS, type LayerDef } from './catalog';
import { isCustomLayerCode } from './custom';
import { COLUMN_BUTTON, QuickBases, QuickDated, QuickOverlays } from './QuickLayers';
import { quickGroupOf } from './quick-layers';
import { isListed } from './settings';

// The layer switcher at the top right: the column of quick layers, which has the basemap circles and the heatmap
// button with group menus (QuickLayers, design layer-thumbnails, design quick-layer-menus), and under them the All
// layers button with the full list (design add-web-map-layers, «Переключатель»: the expanded list of the old client
// covered half of the screen on a phone). In the full list, custom basemaps are radio buttons (the catalog basemaps are
// in the column circles, design custom-bases-in-list), overlays are check boxes, and the order is the stacking order of
// the catalog. The column is a MapLibre control (ControlPortal): it renders
// inside BaseMap before MapButtons, and the map buttons go under it.
//
// Overlays are in sections that do not collapse (design uniform-layer-menus; before, they were collapsed, design
// compact-all-layers): after custom-bases-in-list the panel has almost only overlays, and a collapsed section hid the
// full list. The «Overlays» section has the overlays of the catalog groups that have a default layer (Default layers,
// Miscellaneous, Routes and traces). The groups without default layers (Topo maps, Norway, custom layers) are rare, and
// each of them has its own section with a heading.

const OVERLAYS_SECTION = 'Overlays';
// the group of custom layers by URL, as in custom.ts and ConfigureLayersDialog
const SECTION_ORDER = [OVERLAYS_SECTION, ...GROUPS, 'Custom layers'];

function overlaySections(overlays: LayerDef[], layers: ReadonlyMap<string, LayerDef>): [string, LayerDef[]][] {
    const common = new Set([...layers.values()].filter((layer) => layer.isDefault).map((layer) => layer.group));
    const sectionOf = (layer: LayerDef) => (common.has(layer.group) ? OVERLAYS_SECTION : layer.group);
    // a group that is not in GROUPS (new in the catalog) gets a section at the end and does not disappear from the list
    const names = new Set([...SECTION_ORDER, ...overlays.map(sectionOf)]);
    return [...names].flatMap((name): [string, LayerDef[]][] => {
        const items = overlays.filter((layer) => sectionOf(layer) === name);
        return items.length > 0 ? [[name, items]] : [];
    });
}

function LayerHint({ layer }: { layer: LayerDef }) {
    if (layer.minZoom === undefined) {
        return null;
    }
    // the zoom is in the units of the old client (Leaflet), as the label "zoom ≥ 12" of its coverage overview
    return <span className="whitespace-nowrap text-muted-foreground text-xs">zoom ≥ {layer.minZoom + 1}</span>;
}

export function LayerSwitcher() {
    const layers = useAppStore((state) => state.layers);
    const settings = useAppStore((state) => state.settings);
    const selection = useAppStore((state) => state.selection);
    const selectBase = useAppStore((state) => state.selectBase);
    const toggleOverlay = useAppStore((state) => state.toggleOverlay);
    const [open, setOpen] = useState(false);
    const [configOpen, setConfigOpen] = useState(false);
    // null — the dialog is closed, '' — a new layer, a code — an edit of a custom layer
    const [customCode, setCustomCode] = useState<string | null>(null);

    const listed = useMemo(() => {
        const visible = [...layers.values()].filter(
            (layer) =>
                isListed(layer, settings) || selection.base === layer.code || selection.overlays.includes(layer.code),
        );
        return visible.sort((a, b) => a.order - b.order || a.code.localeCompare(b.code));
    }, [layers, settings, selection]);
    // the column circles and their menus select the catalog basemaps, and dated imagery has its own button
    // (QuickLayers): the list has only custom basemaps, because they have no group and no other place (design
    // custom-bases-in-list)
    const bases = listed.filter((layer) => !layer.isOverlay && isCustomLayerCode(layer.code));
    // Strava heatmaps are only in the column button with a menu (owner 2026-10-29, design custom-bases-in-list)
    const overlays = listed.filter((layer) => layer.isOverlay && !quickGroupOf(layer.code));
    const sections = overlaySections(overlays, layers);

    function row(layer: LayerDef) {
        const text = (
            <span>
                {layer.title} <LayerHint layer={layer} />
            </span>
        );
        // a 24 px row with a 14 px font, as menu items (the uniformity rule in AGENTS.md, design uniform-layer-menus)
        const labelClass = 'flex min-h-6 flex-1 cursor-pointer items-center gap-2';
        return (
            <div key={layer.code} className="flex items-center gap-1 px-1">
                {layer.isOverlay ? (
                    <label className={labelClass} data-layer={layer.code}>
                        <Checkbox
                            checked={selection.overlays.includes(layer.code)}
                            onCheckedChange={() => toggleOverlay(layer.code)}
                        />
                        {text}
                    </label>
                ) : (
                    <label className={labelClass} data-layer={layer.code}>
                        <RadioGroupItem value={layer.code} />
                        {text}
                    </label>
                )}
                {isCustomLayerCode(layer.code) && (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Edit layer ${layer.title}`}
                        onClick={() => {
                            setOpen(false);
                            setCustomCode(layer.code);
                        }}
                    >
                        <PencilIcon />
                    </Button>
                )}
            </div>
        );
    }

    function section([name, items]: [string, LayerDef[]]) {
        return (
            // without custom basemaps, the section is the first in the panel, and the line above it is extra
            <fieldset
                key={name}
                // clear-left: without it, w-max of the panel counts the floating legend and the first row as one line,
                // and the panel becomes wider than necessary
                className="border-border border-t pt-0.5 first:border-t-0 first:pt-0 [&>legend+*]:clear-left"
            >
                {/* the heading is like the DropdownMenuLabel label: 12 px, muted (the uniformity rule in AGENTS.md) */}
                <legend className="float-left w-full px-1 py-1 font-medium text-muted-foreground text-xs">
                    {name}
                </legend>
                {items.map((layer) => row(layer))}
            </fieldset>
        );
    }

    return (
        // the map is between the circles: the container lets the pointer through, the buttons (COLUMN_BUTTON) do not.
        // pointer-events with !: the MapLibre CSS outside @layer sets pointer-events: auto on .maplibregl-ctrl
        <ControlPortal className="pointer-events-none! flex flex-col items-center gap-2" first>
            {/* the map buttons above the bottom panels have priority over the quick layers: what does not fit in height
                goes to the second column of the wrapper and is cut off (flex-wrap + overflow-hidden), so Street View,
                zoom and geolocation do not go under the profile and the panorama. 15rem is All layers, Street View,
                zoom, geolocation with gaps. Negative margins cancel the paddings, and the column keeps the width of a
                circle: py-1 and pr-1 are for the outline of the marked circle, pl-2.5 is for the menu badge at the left
                edge of the circle with its touch area (QuickLayers). gap-x-4 moves the wrapped part fully out of the
                cut: with gap-2, its badges and outlines stuck out into the right padding and received clicks */}
            <fieldset className="-my-1 -mr-1 -ml-2.5 flex max-h-[calc(100dvh-var(--bottom-inset)-15rem)] w-12.5 flex-col flex-wrap items-center gap-x-4 gap-y-2 overflow-hidden py-1 pr-1 pl-2.5">
                <legend className="sr-only">Quick layers</legend>
                {/* the column functions, always present: at the top, the buttons with menus (three basemap circles and
                    the heatmap), under them dated imagery (owner 2026-10-29, design custom-bases-in-list) */}
                <QuickBases />
                <QuickOverlays />
                <QuickDated />
            </fieldset>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <Button
                            variant="ghost"
                            size="icon-lg"
                            className={COLUMN_BUTTON}
                            aria-label="All layers"
                            title="All layers"
                            data-testid="layers-button"
                        />
                    }
                >
                    <LayersIcon />
                </PopoverTrigger>
                {/* to the left of the column, not down over Street View and zoom. The width follows the longest row,
                    but is not more than the window without the button column on the right (4.5rem). The height is not
                    more than the space that the Base UI positioner gives (--available-height), the rest scrolls */}
                <PopoverContent
                    side="left"
                    align="start"
                    className="max-h-(--available-height) w-max max-w-[min(20rem,calc(100vw-4.5rem))] gap-0.5 overflow-y-auto overscroll-contain p-1.5"
                    data-testid="layer-switcher"
                >
                    {bases.length > 0 && (
                        <RadioGroup
                            aria-label="Base layer"
                            value={selection.base}
                            onValueChange={(code) => selectBase(String(code))}
                            className="gap-0"
                        >
                            {bases.map((layer) => row(layer))}
                        </RadioGroup>
                    )}
                    {sections.map(section)}
                    {/* first in the panel when the list has no custom basemaps and no overlays: the line above it is
                        extra */}
                    <div className="flex flex-col border-border border-t pt-0.5 first:border-t-0 first:pt-0">
                        <Button
                            variant="ghost"
                            size="xs"
                            className="justify-start font-normal"
                            onClick={() => {
                                setOpen(false);
                                setConfigOpen(true);
                            }}
                        >
                            <Settings2Icon /> Configure layers
                        </Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="justify-start font-normal"
                            onClick={() => {
                                setOpen(false);
                                setCustomCode('');
                            }}
                        >
                            <PlusIcon /> Add custom layer
                        </Button>
                    </div>
                </PopoverContent>
            </Popover>
            <ConfigureLayersDialog open={configOpen} onOpenChange={setConfigOpen} />
            {customCode !== null && <CustomLayerDialog code={customCode || null} onClose={() => setCustomCode(null)} />}
        </ControlPortal>
    );
}
