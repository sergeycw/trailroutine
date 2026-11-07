import { cn } from 'cn';
import { CalendarIcon, CheckIcon, CloudIcon, LoaderCircleIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAppStore, useAppStoreApi } from '@/state/context';
import {
    ageDays,
    type ImageryDate as DateItem,
    defaultDate,
    FIRST_DATE,
    fetchDates,
    HLS_LATENCY_DAYS,
    isDate,
    isoDay,
    type Point,
} from './dated';

// The date button of dated imagery at the bottom center, next to the profile button (design add-dated-imagery,
// «Кнопка даты снизу по центру»): it is visible while the basemap is a layer with dated. If the store has no date, the
// button itself gets the default date from Earth Search over the map center. The date list loads on a click, and loads
// again if the map moved away from the point of the previous request.

// ≈ 10 km: farther away is another MGRS square, with its own dates and cloud cover
const RELOAD_DEGREES = 0.1;

type Dates = { center: Point } & ({ status: 'loading' } | { status: 'error' } | { status: 'done'; dates: DateItem[] });

const PILL =
    'glass pointer-events-auto flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3.5 font-medium text-sm tabular-nums transition-colors hover:bg-white/90 [&_svg]:size-4 [&_svg]:shrink-0';

function cloudText(cloudCover: number | null): string | null {
    return cloudCover === null ? null : `${Math.round(cloudCover)}%`;
}

function DateButton({ fetch }: { fetch: typeof window.fetch }) {
    const store = useAppStoreApi();
    const date = useAppStore((state) => state.imageryDate);
    const setDate = useAppStore((state) => state.setImageryDate);
    const [dates, setDates] = useState<Dates | null>(null);
    const [open, setOpen] = useState(false);
    const abort = useRef<AbortController | null>(null);
    const otherId = useId();

    const load = useCallback(() => {
        const { lat, lng } = store.getState().view;
        const center = { lat, lng };
        abort.current?.abort();
        const controller = new AbortController();
        abort.current = controller;
        setDates({ center, status: 'loading' });
        const today = new Date();
        fetchDates(fetch, center, today, controller.signal).then(
            (found) => {
                if (controller.signal.aborted) {
                    return;
                }
                // an empty answer (open ocean, polar night) is also "unavailable": the list has nothing to choose,
                // only Other date stays
                setDates(found.length ? { center, status: 'done', dates: found } : { center, status: 'error' });
                // the default date only if there is still no date: the user could choose a date during the request
                const fallback = defaultDate(found, today);
                if (store.getState().imageryDate === null && fallback) {
                    store.getState().setImageryDate(fallback);
                }
            },
            () => {
                if (!controller.signal.aborted) {
                    setDates({ center, status: 'error' });
                }
            },
        );
    }, [fetch, store]);

    // without a date, request the dates for the default date; after an error, only the Retry button repeats the request
    useEffect(() => {
        if (date === null && dates === null) {
            load();
        }
    }, [date, dates, load]);

    useEffect(() => () => abort.current?.abort(), []);

    function onOpenChange(next: boolean) {
        setOpen(next);
        if (!next) {
            return;
        }
        const { lat, lng } = store.getState().view;
        const moved =
            !dates ||
            Math.abs(dates.center.lat - lat) > RELOAD_DEGREES ||
            Math.abs(dates.center.lng - lng) > RELOAD_DEGREES;
        if (moved || dates.status === 'error') {
            load();
        }
    }

    function commitOther(value: string) {
        if (value !== date && isDate(value) && value >= FIRST_DATE && value <= isoDay(new Date())) {
            choose(value);
        }
    }

    function choose(next: string) {
        setDate(next);
        setOpen(false);
    }

    const today = new Date();
    const current = dates?.status === 'done' ? dates.dates.find((item) => item.date === date) : undefined;
    const cloud = current ? cloudText(current.cloudCover) : null;
    let label: string;
    if (date) {
        label = date;
    } else if (dates?.status === 'error') {
        label = 'Dates unavailable';
    } else {
        label = 'Loading dates';
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger
                render={<button type="button" className={PILL} title="Imagery date" data-testid="imagery-date" />}
            >
                {!date && dates?.status !== 'error' ? (
                    <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
                ) : (
                    <CalendarIcon aria-hidden="true" />
                )}
                <span className="sr-only">Imagery date</span>
                {label}
                {cloud && (
                    <span className="flex items-center gap-1 font-normal text-muted-foreground">
                        <CloudIcon aria-hidden="true" />
                        {cloud}
                    </span>
                )}
            </PopoverTrigger>
            {/* upward: the button is at the bottom, the map is above it */}
            <PopoverContent
                side="top"
                className="max-h-[min(var(--available-height),24rem)] w-max max-w-[calc(100vw-1.5rem)] gap-1 overflow-y-auto overscroll-contain p-1.5"
                data-testid="imagery-dates"
            >
                <div className="px-1.5 pt-0.5 font-medium text-muted-foreground text-xs">
                    Satellite passes near the map center, last 90 days
                </div>
                {dates?.status === 'loading' && (
                    <div role="status" className="flex items-center gap-2 px-1.5 py-1 text-muted-foreground">
                        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
                        Loading dates…
                    </div>
                )}
                {dates?.status === 'error' && (
                    <div role="status" className="flex items-center gap-2 px-1.5 py-1">
                        <span className="text-muted-foreground">Dates unavailable</span>
                        <Button variant="outline" size="xs" onClick={load}>
                            Retry
                        </Button>
                    </div>
                )}
                {dates?.status === 'done' && (
                    <ul className="flex flex-col" aria-label="Imagery dates">
                        {dates.dates.map((item) => {
                            const selected = item.date === date;
                            const fresh = ageDays(item.date, today) < HLS_LATENCY_DAYS;
                            return (
                                <li key={item.date}>
                                    <button
                                        type="button"
                                        aria-pressed={selected}
                                        data-date={item.date}
                                        onClick={() => choose(item.date)}
                                        className={cn(
                                            'flex min-h-6 w-full cursor-pointer items-center gap-3 rounded-md px-1.5 text-left tabular-nums outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50',
                                            selected && 'font-medium',
                                        )}
                                    >
                                        <CheckIcon
                                            className={cn('size-3.5 shrink-0', !selected && 'invisible')}
                                            aria-hidden="true"
                                        />
                                        <span>{item.date}</span>
                                        <span className="flex w-14 items-center gap-1 text-muted-foreground">
                                            <CloudIcon className="size-3.5 shrink-0" aria-hidden="true" />
                                            {cloudText(item.cloudCover) ?? '—'}
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {item.satellites.join(', ')}
                                            {fresh && ' · may not be ready'}
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
                <label
                    htmlFor={otherId}
                    className="flex items-center gap-2 border-border border-t px-1.5 pt-1.5 text-muted-foreground text-xs"
                >
                    Other date
                    {/* key: after a choice from the list, the field shows the new date, not the date typed before */}
                    <Input
                        key={date}
                        id={otherId}
                        type="date"
                        min={FIRST_DATE}
                        max={isoDay(today)}
                        defaultValue={date ?? ''}
                        className="h-7 w-auto"
                        // on Enter and on blur, not on input: Chromium sends input for each date segment, and month
                        // 1 of «10» already gave a complete date, so the list closed in the middle of the input (diff
                        // review)
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                commitOther(event.currentTarget.value);
                            }
                        }}
                        onBlur={(event) => commitOther(event.currentTarget.value)}
                    />
                </label>
            </PopoverContent>
        </Popover>
    );
}

export function ImageryDateButton({ fetch }: { fetch: typeof window.fetch }) {
    const dated = useAppStore((state) => state.layers.get(state.selection.base)?.dated === true);
    return dated ? <DateButton fetch={fetch} /> : null;
}
