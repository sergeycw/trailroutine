import { useContext, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { config } from '@/config';
import { AppStoreContext, useAppStore } from '@/state/context';
import {
    type CorsCheck,
    type CustomLayerFields,
    checkCors,
    parseCustomLayerCode,
    probeTileUrl,
    serializeCustomLayer,
    unsupportedTokens,
} from './custom';
import { isListed } from './settings';

// A custom layer by URL: the form fields of the old client (showCustomLayerForm in leaflet.control.layers.configure),
// except scaleDependent (only printing used it). Before the save, the form checks CORS with one tile at the view center
// (design, «Свои слои»): WebGL does not show a tile without CORS, so the form offers the proxy of the clone.

const MAX_ZOOMS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

const NEW_LAYER: CustomLayerFields = {
    name: 'Custom layer',
    url: '',
    tms: false,
    scaleDependent: false,
    maxZoom: 18,
    isOverlay: false,
    isTop: true,
};

const CORS_MESSAGES: Record<Exclude<CorsCheck, 'ok'>, string> = {
    'no-cors': 'The tile server does not allow loading its tiles on other sites (no CORS). Use proxy to load them.',
    unreachable:
        'A tile in the map center did not load: the server is not reachable or has no tile here. ' +
        'Press the button again to save the layer anyway.',
};

interface CustomLayerDialogProps {
    // null for a new layer
    code: string | null;
    onClose: () => void;
}

export function CustomLayerDialog({ code, onClose }: CustomLayerDialogProps) {
    const store = useContext(AppStoreContext);
    const layers = useAppStore((state) => state.layers);
    const settings = useAppStore((state) => state.settings);
    const [fields, setFields] = useState<CustomLayerFields>(() => (code && parseCustomLayerCode(code)) || NEW_LAYER);
    const [message, setMessage] = useState<string | null>(null);
    // the check failed because the tile is unreachable: a second click saves the layer without the check
    const [warnedFor, setWarnedFor] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const id = useId();

    function update(patch: Partial<CustomLayerFields>) {
        setFields((prev) => ({ ...prev, ...patch }));
        setMessage(null);
        setWarnedFor(null);
    }

    function validate(values: CustomLayerFields): string | null {
        if (!values.url) {
            return 'Url is empty';
        }
        if (!values.name) {
            return 'Name is empty';
        }
        const unsupported = unsupportedTokens(values.url);
        if (unsupported.length) {
            return `Variables ${unsupported.join(', ')} are not supported`;
        }
        const duplicate = layers.get(serializeCustomLayer(values));
        if (duplicate && duplicate.code !== code) {
            return isListed(duplicate, settings)
                ? 'Same layer already exists'
                : 'Same layer already exists but it is hidden. You can enable it in layers setting.';
        }
        return null;
    }

    async function submit() {
        if (!store) {
            return;
        }
        const values = { ...fields, name: fields.name.trim(), url: fields.url.trim() };
        const error = validate(values);
        if (error) {
            setMessage(error);
            return;
        }
        const tileUrl = probeTileUrl(values, store.getState().view, store.getState().view.zoom, config.corsProxyUrl);
        if (warnedFor !== tileUrl) {
            setChecking(true);
            const result = await checkCors(tileUrl);
            setChecking(false);
            if (result !== 'ok') {
                setMessage(CORS_MESSAGES[result]);
                setWarnedFor(result === 'unreachable' ? tileUrl : null);
                return;
            }
        }
        const state = store.getState();
        if (code) {
            state.replaceCustomLayer(code, values);
        } else {
            state.addCustomLayer(values);
        }
        onClose();
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{code ? 'Edit custom layer' : 'Add custom layer'}</DialogTitle>
                </DialogHeader>
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
                        Layer name
                        <Input
                            id={`${id}-name`}
                            maxLength={40}
                            value={fields.name}
                            onChange={(event) => update({ name: event.target.value })}
                        />
                    </label>
                    <div className="flex flex-col gap-1">
                        <label htmlFor={`${id}-url`}>Tile url template</label>
                        <textarea
                            id={`${id}-url`}
                            aria-describedby={`${id}-url-hint`}
                            className="min-h-16 rounded-lg border border-input px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                            placeholder="https://tile.example.com/{z}/{x}/{y}.png"
                            value={fields.url}
                            onChange={(event) => update({ url: event.target.value })}
                        />
                        <span id={`${id}-url-hint`} className="text-muted-foreground text-xs">
                            Variables: {'{z}'}, {'{x}'}, {'{y}'}, {'{-y}'}, {'{s}'} (a, b, c), {'{r}'} (@2x on retina)
                        </span>
                    </div>
                    <RadioGroup
                        aria-label="Layer type"
                        value={fields.isOverlay ? 'overlay' : 'base'}
                        onValueChange={(value) => update({ isOverlay: value === 'overlay' })}
                        className="grid-cols-2"
                    >
                        <label className="flex items-center gap-2">
                            <RadioGroupItem value="base" /> Base layer
                        </label>
                        <label className="flex items-center gap-2">
                            <RadioGroupItem value="overlay" /> Overlay
                        </label>
                    </RadioGroup>
                    <RadioGroup
                        aria-label="Overlay position"
                        value={fields.isTop ? 'top' : 'bottom'}
                        onValueChange={(value) => update({ isTop: value === 'top' })}
                        disabled={!fields.isOverlay}
                        className="grid-cols-2"
                    >
                        <label className="flex items-center gap-2">
                            <RadioGroupItem value="bottom" /> Below other layers
                        </label>
                        <label className="flex items-center gap-2">
                            <RadioGroupItem value="top" /> Above other layers
                        </label>
                    </RadioGroup>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <label className="flex items-center gap-2">
                            <Checkbox checked={fields.tms} onCheckedChange={(tms) => update({ tms })} /> TMS rows order
                        </label>
                        <label className="flex items-center gap-2">
                            <Checkbox
                                checked={Boolean(fields.corsProxy)}
                                onCheckedChange={(corsProxy) => update({ corsProxy })}
                            />
                            Use proxy
                        </label>
                        <label className="flex items-center gap-2" htmlFor={`${id}-zoom`}>
                            Max zoom
                            <select
                                id={`${id}-zoom`}
                                className="h-7 rounded-lg border border-input px-1"
                                value={fields.maxZoom}
                                onChange={(event) => update({ maxZoom: Number(event.target.value) })}
                            >
                                {MAX_ZOOMS.map((zoom) => (
                                    <option key={zoom} value={zoom}>
                                        {zoom}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    {message && (
                        <p role="alert" className="text-destructive text-sm">
                            {message}
                        </p>
                    )}
                    <DialogFooter>
                        {code && (
                            <Button
                                type="button"
                                variant="destructive"
                                onClick={() => {
                                    store?.getState().removeCustomLayer(code);
                                    onClose();
                                }}
                            >
                                Delete
                            </Button>
                        )}
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={checking}>
                            {code ? 'Save' : 'Add layer'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
