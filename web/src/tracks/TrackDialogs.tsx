import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAppStore } from '@/state/context';
import { useTrackActions } from './actions-context';
import type { Track } from './model';

export function RenameTrackDialog({ track, onClose }: { track: Track; onClose: () => void }) {
    const actions = useTrackActions();
    const [name, setName] = useState(track.name);

    function submit() {
        actions.rename(track, name);
        onClose();
    }

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Rename track</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <Input aria-label="Track name" value={name} onChange={(event) => setName(event.target.value)} />
                </form>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button onClick={submit}>Ok</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Track point name: after the point is added and by Rename in the point menu (prompt «New point name» of the old
// client). Cancel keeps the previous name, an empty name is allowed.
export function PointNameDialog() {
    const dialog = useAppStore((state) => state.pointDialog);
    return dialog ? <PointNameForm key={`${dialog.trackId}:${dialog.point.name}`} /> : null;
}

function PointNameForm() {
    const actions = useTrackActions();
    const dialog = useAppStore((state) => state.pointDialog);
    const setPointDialog = useAppStore((state) => state.setPointDialog);
    const [name, setName] = useState(dialog?.point.name ?? '');
    if (!dialog) {
        return null;
    }
    const close = () => setPointDialog(null);
    function submit() {
        if (dialog) {
            actions.renamePoint(dialog.trackId, dialog.point, name);
        }
        close();
    }
    return (
        <Dialog open onOpenChange={(open) => !open && close()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Point name</DialogTitle>
                </DialogHeader>
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <Input
                        aria-label="Point name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onFocus={(event) => event.target.select()}
                    />
                </form>
                <DialogFooter>
                    <Button variant="outline" onClick={close}>
                        Cancel
                    </Button>
                    <Button onClick={submit}>Ok</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// Text that could not go to the clipboard: a link to tracks (design add-web-tracks, «Ссылка — после ответа хранилища»),
// point coordinates (design add-web-line-tools, «Точки трека»)
export function CopyFallbackDialog() {
    const fallback = useAppStore((state) => state.copyFallback);
    const setCopyFallback = useAppStore((state) => state.setCopyFallback);
    const [copied, setCopied] = useState(false);

    function close() {
        setCopyFallback(null);
        setCopied(false);
    }

    return (
        <Dialog open={fallback !== null} onOpenChange={(open) => !open && close()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{fallback?.title}</DialogTitle>
                </DialogHeader>
                <Input
                    readOnly
                    aria-label={fallback?.title}
                    value={fallback?.text ?? ''}
                    onFocus={(event) => event.target.select()}
                />
                <DialogFooter>
                    <Button
                        onClick={() => {
                            navigator.clipboard.writeText(fallback?.text ?? '').then(
                                () => setCopied(true),
                                () => {},
                            );
                        }}
                    >
                        {copied ? 'Copied' : 'Copy'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
