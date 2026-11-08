import { MessageSquareTextIcon, PaperclipIcon, XIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { ROUND_BUTTON } from '@/components/round-button';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { config } from '@/config';
import { useAppStore } from '@/state/context';
import { type FeedbackResult, filesBytes, MAX_FILES, MAX_FILES_BYTES, sendFeedback } from './send';

// The feedback button at the bottom right and its form (change add-feedback, spec feedback; the draft was approved by
// the owner on 2026-11-08). The form asks for an email for the reply (required: an anonymous form gets spam), the
// message and files; the tracks of the list go as a link, the user can turn them off. The transport (email) is not
// visible to the user.

const ERRORS: Record<Exclude<FeedbackResult, 'sent'>, string> = {
    'too-big': `Too many files: up to ${MAX_FILES} files and ${MAX_FILES_BYTES / 1024 / 1024} MB in all.`,
    'rate-limited': 'Too many messages. Try again in a minute.',
    failed: 'Could not send the message. Check the connection and try again.',
};

function fileSize(bytes: number): string {
    return bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface FeedbackButtonProps {
    fetch: typeof fetch;
    notify: (title: string, type?: 'error' | 'success') => void;
}

export function FeedbackButton({ fetch, notify }: FeedbackButtonProps) {
    const [open, setOpen] = useState(false);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [withTracks, setWithTracks] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const tracks = useAppStore((state) => state.tracks);
    const fileInput = useRef<HTMLInputElement>(null);
    const formId = useId();
    const tooBig = files.length > MAX_FILES || filesBytes(files) > MAX_FILES_BYTES;

    async function submit() {
        setSending(true);
        setError(null);
        const result = await sendFeedback(
            { email, message, files, tracks: withTracks ? tracks : null },
            {
                fetch,
                feedbackUrl: config.feedbackUrl,
                tracksStorageServer: config.tracksStorageServer,
                location: window.location,
                userAgent: navigator.userAgent,
                screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
            },
        );
        setSending(false);
        if (result !== 'sent') {
            setError(ERRORS[result]);
            return;
        }
        notify(`Thanks! We will reply to ${email.trim()}.`, 'success');
        setOpen(false);
        setMessage('');
        setFiles([]);
    }

    return (
        <>
            <Button
                variant="ghost"
                size="icon-lg"
                // the bottom is level with the attribution and the profile button (12 px), above the bottom panels
                className={`${ROUND_BUTTON} absolute right-3 bottom-[calc(var(--bottom-inset,0px)+0.75rem)] z-10`}
                title="Send feedback"
                aria-label="Send feedback"
                onClick={() => {
                    setError(null);
                    setOpen(true);
                }}
            >
                <MessageSquareTextIcon />
            </Button>
            <Dialog open={open} onOpenChange={(value) => !sending && setOpen(value)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Send feedback</DialogTitle>
                        <DialogDescription>A question, a bug or an idea. We reply by email.</DialogDescription>
                    </DialogHeader>
                    <form
                        id={formId}
                        className="flex flex-col gap-3"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        <Input
                            type="email"
                            required
                            autoComplete="email"
                            placeholder="Your email"
                            aria-label="Your email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                        />
                        <textarea
                            required
                            rows={5}
                            maxLength={10000}
                            placeholder="What happened or what do you need?"
                            aria-label="Message"
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                        />
                        <div className="flex flex-col gap-1">
                            {files.map((file, index) => (
                                <div
                                    // biome-ignore lint/suspicious/noArrayIndexKey: two files can have the same name
                                    key={index}
                                    className="flex min-h-6 items-center gap-1.5 text-sm"
                                    data-testid="feedback-file"
                                >
                                    <PaperclipIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                        {fileSize(file.size)}
                                    </span>
                                    <button
                                        type="button"
                                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                                        aria-label={`Remove ${file.name}`}
                                        onClick={() => setFiles(files.filter((_, i) => i !== index))}
                                    >
                                        <XIcon className="size-3.5" />
                                    </button>
                                </div>
                            ))}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="self-start"
                                onClick={() => fileInput.current?.click()}
                            >
                                <PaperclipIcon /> Attach files
                            </Button>
                            <input
                                ref={fileInput}
                                type="file"
                                multiple
                                hidden
                                aria-label="Files"
                                onChange={(event) => {
                                    setFiles([...files, ...(event.target.files ?? [])]);
                                    // the same file again after a removal is a change too
                                    event.target.value = '';
                                }}
                            />
                        </div>
                        {tracks.length > 0 && (
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                    checked={withTracks}
                                    onCheckedChange={(value) => setWithTracks(value === true)}
                                />
                                Attach my tracks ({tracks.length})
                            </label>
                        )}
                        <p className="text-muted-foreground text-xs">
                            The message also has the map view and your browser version. Up to{' '}
                            {MAX_FILES_BYTES / 1024 / 1024} MB of files.
                        </p>
                        {(error || tooBig) && (
                            <p className="text-destructive text-sm" role="alert">
                                {tooBig ? ERRORS['too-big'] : error}
                            </p>
                        )}
                    </form>
                    <DialogFooter>
                        <Button variant="outline" disabled={sending} onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" form={formId} disabled={sending || tooBig}>
                            {sending ? 'Sending…' : 'Send'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
