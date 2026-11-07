import { type KeyboardEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useTrackActions } from '@/tracks/actions-context';
import type { Track } from '@/tracks/model';

type Latest = { draft: string | null; track: Track; actions: ReturnType<typeof useTrackActions> };

function commit(latest: RefObject<Latest>) {
    const { draft, track, actions } = latest.current;
    latest.current.draft = null;
    if (draft !== null && draft !== track.name) {
        actions.rename(track, draft);
    }
}

// The track name in the editor row (design editor-name-share): a field that looks like text. While the field has focus,
// the name is a draft. Enter and a focus loss call rename (an empty name does not change the track). Escape restores
// the previous name. Editor keys do not work in the field (INPUT filter in MapEditor.tsx): Escape does not end editing.
export function TrackNameInput({ track }: { track: Track }) {
    const actions = useTrackActions();
    const [draft, setDraft] = useState<string | null>(null);
    // the draft and the track are in a ref: blur (it runs synchronously, before the new render) and unmount read them
    const latest = useRef<Latest>({ draft, track, actions });
    latest.current = { draft, track, actions };

    // the panel disappeared while the field had focus: iOS Safari does not move the focus to the pressed button
    // Finish editing, and it does not send blur when the field is removed, so the draft is saved here
    useEffect(() => () => commit(latest), []);

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        // Enter and Escape that confirm or cancel an IME composition do not end the edit; Safari sends keydown after
        // compositionend, and there only keyCode 229 shows the composition
        if (event.nativeEvent.isComposing || event.keyCode === 229) {
            return;
        }
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            latest.current.draft = null;
            event.currentTarget.blur();
        }
    }

    return (
        <Input
            aria-label="Track name"
            title={track.name}
            value={draft ?? track.name}
            className="min-w-0 flex-1 truncate border-transparent px-1 font-medium hover:border-input"
            onFocus={(event) => {
                setDraft(track.name);
                // people usually replace the whole name («Track 1» → their own name)
                event.currentTarget.select();
            }}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                commit(latest);
                setDraft(null);
            }}
            onKeyDown={onKeyDown}
        />
    );
}
