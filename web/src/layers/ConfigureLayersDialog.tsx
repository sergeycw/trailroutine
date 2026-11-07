import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAppStore } from '@/state/context';
import { GROUPS, type LayerDef } from './catalog';
import { isCustomLayerCode } from './custom';
import { isColumnButton } from './quick-layers';
import { isListed, listedByDefault } from './settings';

// Layer list settings, as LayersConfigDialog of the old client (leaflet.control.layers.configure): layers by group,
// each with an "in the list" check box. Reset sets the defaults (listedByDefault), Cancel keeps the list, Ok saves it.
// Layers have no hotkeys (owner decision, design add-web-map-layers). The dialog does not show the column buttons (the
// first layers of the groups and dated imagery): they are always in the column, and the check box has no effect on
// them (design custom-bases-in-list).

type Draft = Record<string, boolean>;

interface ConfigureLayersDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function ConfigureLayersDialog({ open, onOpenChange }: ConfigureLayersDialogProps) {
    const layers = useAppStore((state) => state.layers);
    const settings = useAppStore((state) => state.settings);
    const updateSettings = useAppStore((state) => state.updateSettings);
    const [draft, setDraft] = useState<Draft | null>(null);

    const all = [...layers.values()];
    const current: Draft = draft ?? Object.fromEntries(all.map((layer) => [layer.code, isListed(layer, settings)]));

    function close() {
        setDraft(null);
        onOpenChange(false);
    }

    const shown = all.filter((layer) => !isColumnButton(layer.code) && !layer.dated);
    const groups: [string, LayerDef[]][] = [...GROUPS, 'Custom layers'].map((group) => [
        group,
        shown
            .filter((layer) => (isCustomLayerCode(layer.code) ? 'Custom layers' : layer.group) === group)
            .sort((a, b) => a.order - b.order),
    ]);

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_1fr_auto] sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Configure layers</DialogTitle>
                </DialogHeader>
                <div className="-mx-4 overflow-y-auto px-4">
                    {groups
                        .filter(([, items]) => items.length > 0)
                        .map(([group, items]) => (
                            <section key={group} className="pb-3">
                                <h3 className="pb-1 font-medium text-muted-foreground text-xs">{group}</h3>
                                {items.map((layer) => (
                                    <label key={layer.code} className="flex min-h-6 cursor-pointer items-center gap-2">
                                        <Checkbox
                                            checked={current[layer.code]}
                                            onCheckedChange={(checked) =>
                                                setDraft({ ...current, [layer.code]: checked })
                                            }
                                        />
                                        {layer.title}
                                    </label>
                                ))}
                            </section>
                        ))}
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => {
                            // the defaults of the catalog and of the column groups (listedByDefault); custom layers are
                            // not in the defaults, so Reset hides them, as Reset of the old dialog does
                            setDraft(
                                Object.fromEntries(
                                    all.map((layer) => [
                                        layer.code,
                                        !isCustomLayerCode(layer.code) && listedByDefault(layer),
                                    ]),
                                ),
                            );
                        }}
                    >
                        Reset
                    </Button>
                    <Button variant="outline" onClick={close}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => {
                            updateSettings({ listed: current });
                            close();
                        }}
                    >
                        Ok
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
