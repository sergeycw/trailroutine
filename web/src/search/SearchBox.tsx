import { LoaderCircleIcon, SearchIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppStoreApi } from '@/state/context';
import { useTrackActions } from '@/tracks/actions-context';
import { isCoordinatesQuery } from './coordinates';
import { isLinkQuery } from './links';
import { isTrackLinkResult, type SearchItem } from './result';
import { type Attribution, MIN_QUERY_LENGTH, SEARCH_HINT, type SearchSources, search } from './search';

// The search bar in its own glass capsule in the top bar (TopBar.tsx, design layout-three-zones; earlier design
// add-web-search-panoramas, «Где живёт строка поиска»): the results are a list under the bar while the focus is
// inside; the keys are SearchViewModel.onKeyDown of the old client. Search providers run after an input pause,
// coordinates and links at once. An answer to an outdated request is dropped (the request number), the previous
// request is cancelled.

const TYPING_DELAY_MS = 400;

type Shown =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'results'; results: SearchItem[]; attribution: Attribution | null }
    | { kind: 'error'; message: string };

export function SearchBox({ sources }: { sources: SearchSources }) {
    const store = useAppStoreApi();
    const trackActions = useTrackActions();
    const [query, setQuery] = useState('');
    const [shown, setShown] = useState<Shown>({ kind: 'idle' });
    const [active, setActive] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const input = useRef<HTMLInputElement>(null);
    const request = useRef<{ seq: number; abort: AbortController | null; timer?: ReturnType<typeof setTimeout> }>({
        seq: 0,
        abort: null,
    });
    const listId = useId();

    function cancel() {
        const current = request.current;
        clearTimeout(current.timer);
        current.abort?.abort();
        current.abort = null;
        current.seq += 1;
    }

    function start(text: string) {
        cancel();
        const trimmed = text.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            setShown({ kind: 'idle' });
            return;
        }
        const seq = request.current.seq;
        // the previous results go away at once: otherwise Enter during the input pause would choose the answer to the
        // old request
        setShown({ kind: 'loading' });
        const run = async () => {
            const abort = new AbortController();
            request.current.abort = abort;
            const { view } = store.getState();
            setShown({ kind: 'loading' });
            try {
                const outcome = await search(
                    trimmed,
                    {
                        lat: view.lat,
                        lng: view.lng,
                        zoom: view.zoom,
                        languages: navigator.languages,
                        signal: abort.signal,
                    },
                    sources,
                );
                if (seq === request.current.seq) {
                    setHighlighted(0);
                    setShown(outcome);
                }
            } catch {
                // cancelled by a new request
            }
        };
        const immediate = isLinkQuery(trimmed) || isCoordinatesQuery(trimmed);
        if (immediate) {
            void run();
        } else {
            request.current.timer = setTimeout(run, TYPING_DELAY_MS);
        }
    }

    // Alt+L puts the focus into the search bar (the hotkey of the old client); code, not key: on macOS Alt changes the
    // character
    // biome-ignore lint/correctness/useExhaustiveDependencies: cancel reads only a ref
    useEffect(() => {
        const onKey = (event: globalThis.KeyboardEvent) => {
            if (event.altKey && event.code === 'KeyL') {
                event.preventDefault();
                input.current?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            cancel();
        };
    }, []);

    function choose(result: SearchItem) {
        // a track link: the track downloads only now, the map goes to the track, the bar becomes empty, as the Track
        // URL field after the load (design search-track-links, «Результат-трек и выбор»)
        if (isTrackLinkResult(result)) {
            void trackActions.openUrl(result.url);
            setQuery('');
            cancel();
            setShown({ kind: 'idle' });
            leave();
            return;
        }
        const state = store.getState();
        if (result.bounds) {
            state.requestBounds(result.bounds);
        } else {
            state.requestView({ ...result.latlng, zoom: result.zoom ?? state.view.zoom });
        }
        state.setPlacemark({ ...result.latlng, title: result.title });
        leave();
    }

    // the focus goes to the map (escapePressed → setFocusToMap of the old client)
    function leave() {
        setActive(false);
        input.current?.blur();
        document.querySelector<HTMLElement>('.maplibregl-canvas')?.focus();
    }

    const results = shown.kind === 'results' ? shown.results : [];
    const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH;
    // an empty bar in focus explains what it understands: a touch screen does not show the title of the bar
    // (spec map-search, «Строка поиска»)
    const hint = query.trim().length === 0;
    const open =
        active && (hint || results.length > 0 || shown.kind === 'error' || shown.kind === 'loading' || tooShort);

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            setShown({ kind: 'idle' });
            leave();
            return;
        }
        if (!results.length) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlighted((highlighted + 1) % results.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((highlighted - 1 + results.length) % results.length);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(results[Math.min(highlighted, results.length - 1)]);
        }
    }

    return (
        // focus and blur bubble up from the bar and the options: so it is visible that the focus left the search fully
        // in the glass capsule of the route zone (TopBar, design layout-three-zones): the field has no border, the
        // results are a card under the bar
        // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper catches child focus, it is not interactive
        <div
            className="relative min-w-0 flex-1"
            data-testid="search"
            onFocus={() => {
                if (!active) {
                    setActive(true);
                    // the focus came back, and there are no results: search again (onInputHasFocusChange of the old
                    // client)
                    if (shown.kind === 'idle') {
                        start(query);
                    }
                }
            }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setActive(false);
                }
            }}
        >
            <div className="relative">
                <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
                <Input
                    ref={input}
                    className="h-9 border-0 bg-transparent pr-7 pl-8 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    placeholder="Search or paste a track link"
                    title="Search places, coordinates, map or track links (Alt+L)"
                    aria-label="Search"
                    role="combobox"
                    aria-expanded={open && results.length > 0}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        start(event.target.value);
                    }}
                    onKeyDown={onKeyDown}
                />
                {query && (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="-translate-y-1/2 absolute top-1/2 right-1"
                        aria-label="Clear search"
                        onClick={() => {
                            setQuery('');
                            start('');
                            input.current?.focus();
                        }}
                    >
                        <XIcon />
                    </Button>
                )}
            </div>
            {open && (
                <div className="glass -left-1 absolute top-full z-20 mt-2.5 flex max-h-72 w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-1 overflow-y-auto rounded-xl p-2 text-sm">
                    {hint && <p className="text-muted-foreground text-xs">{SEARCH_HINT}</p>}
                    {tooShort && <p className="text-muted-foreground">Type at least {MIN_QUERY_LENGTH} characters</p>}
                    {!tooShort && shown.kind === 'loading' && (
                        <LoaderCircleIcon
                            className="size-4 animate-spin text-muted-foreground"
                            aria-label="Searching"
                        />
                    )}
                    {!tooShort && shown.kind === 'error' && <p data-testid="search-error">{shown.message}</p>}
                    {!tooShort && results.length > 0 && (
                        <div id={listId} role="listbox" aria-label="Search results" className="flex flex-col">
                            {results.map((result, index) => (
                                <div
                                    // biome-ignore lint/suspicious/noArrayIndexKey: two results can have the same name
                                    key={`${result.title}-${index}`}
                                    role="option"
                                    // the focus stays in the bar (aria-activedescendant-like choice with arrow keys)
                                    tabIndex={-1}
                                    aria-selected={index === highlighted}
                                    // the focus stays in the bar: otherwise Safari, which does not focus buttons on
                                    // click, would close the list before the click
                                    onMouseDown={(event) => event.preventDefault()}
                                    onMouseMove={() => setHighlighted(index)}
                                    onClick={() => choose(result)}
                                    onKeyDown={() => {}}
                                    className={`cursor-pointer rounded-md px-2 py-0.5 ${index === highlighted ? 'bg-muted' : ''}`}
                                >
                                    <div className="truncate font-medium">{result.title}</div>
                                    {result.subtitle && (
                                        <div className="truncate text-muted-foreground text-xs">{result.subtitle}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {!tooShort && shown.kind === 'results' && shown.attribution && (
                        <a
                            className="self-end text-muted-foreground text-xs underline"
                            href={shown.attribution.url}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {shown.attribution.text}
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
