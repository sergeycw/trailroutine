// The layer groups of the right column. Three basemap circles, one for each type (owner 2026-10-28, design
// three-quick-bases), and the Strava heatmap button; each has its own layer group for the menu under its badge (owner
// 2026-10-29, design quick-layer-menus). No imports: both the column (QuickLayers.tsx) and the preview script
// scripts/layer-thumbnails.mjs read the groups, and the script cannot import .tsx. Google Map has no license (backlog,
// «Лицензии слоёв и поиска»): if the tiles disappear, replace the first code of the group here, set the place in
// PLACES of the script and capture the preview image again

export interface QuickLayerGroup {
    // the name of the menu badge and of the menu itself (aria-label); it differs from the All layers sections (they
    // have the overlays "Topo maps")
    name: string;
    // the first code is the circle itself (for basemaps, also the preview image), the order is the order of the menu
    // items
    codes: readonly string[];
}

// The content of the basemap groups is the owner's table (design quick-layer-menus). Hls and custom layers are in no
// group; quick-layers.test.ts checks that each catalog basemap, except the layer with dated, is in some group. The
// topo map circle is OpenFreeMap Outdoor, the default basemap (design openfreemap-default-basemap): with Tracestrack
// first, the circle would show its image while Of is on, and after a group change it would return to Tracestrack and
// spend its quota
export const QUICK_BASE_GROUPS: readonly QuickLayerGroup[] = [
    { name: 'Topo layers', codes: ['Of', 'Tt', 'Otm', 'Oso', 'Ocm', 'Co'] },
    { name: 'Map layers', codes: ['G', 'O', 'P'] },
    { name: 'Satellite layers', codes: ['E', 'L', 'I', 'S2'] },
];

// Overlays with a button in the column: the map has one layer of the group (a choice in the menu turns off the
// others), the button turns it on and off. The column has no hillshade (owner 2026-10-29): it is in All layers
export const QUICK_OVERLAY_GROUPS: readonly QuickLayerGroup[] = [
    { name: 'Strava heatmaps', codes: ['Sa', 'Sr', 'Sb', 'Sw'] },
];

export const QUICK_BASES = QUICK_BASE_GROUPS.map((group) => group.codes[0]);

// The first layer of a group is the column button itself: it is always in the menu and in the column, and the Configure
// layers check box has no effect on it
export function isColumnButton(code: string): boolean {
    return quickGroupOf(code)?.codes[0] === code;
}

export function quickGroupOf(code: string): QuickLayerGroup | undefined {
    return [...QUICK_BASE_GROUPS, ...QUICK_OVERLAY_GROUPS].find((group) => group.codes.includes(code));
}

// The column memory: the first code of a group → the group layer that was selected last. The same object if there is
// nothing to remember: the store decides by the settings reference whether to write them to localStorage
export function rememberQuickLayer(memory: Readonly<Record<string, string>>, code: string) {
    const group = quickGroupOf(code);
    if (!group || memory[group.codes[0]] === code) {
        return memory;
    }
    return { ...memory, [group.codes[0]]: code };
}

// The layer that a click on the circle turns on. current is the group layer that is on the map now: a marked circle
// stays on it, otherwise after a link or old settings without memory it would switch to another layer of the same
// type. The first layer of the group replaces a remembered layer that is not in the menu (hidden in Configure layers,
// gone from the catalog)
export function quickTarget(
    group: QuickLayerGroup,
    memory: Readonly<Record<string, string>>,
    current: string | undefined,
    menu: readonly string[],
): string {
    if (current !== undefined) {
        return current;
    }
    const remembered = memory[group.codes[0]];
    return remembered && menu.includes(remembered) ? remembered : group.codes[0];
}
