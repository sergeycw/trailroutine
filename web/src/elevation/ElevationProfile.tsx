import { LoaderCircleIcon, RotateCwIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { config } from '@/config';
import { useAppStore } from '@/state/context';
import type { ProfileData } from '@/state/store';
import { trackColor } from '@/tracks/model';
import { useElevationProfile } from './context';
import { kilometers, meters, profileSections } from './format';
import { ProfileGraph } from './ProfileGraph';
import { type ProfileStats, profileStats, SLOPE_CLASSES, SLOPE_STEPS } from './profile';

// The elevation profile panel (design add-web-elevation-profile, «Где живёт профиль»): full width at the bottom, the
// height is PROFILE_HEIGHT; the profile button, the attribution and the toasts go above it by --bottom-inset (App).
// On a narrow screen: the name, under it the summary in one line (it scrolls), and the graph below them; on a wide
// screen, the name and the summary are a column on the left of the graph. The panel has no close button: the profile
// button (MapActions) closes it.

// in a low window (a phone in landscape), not more than 35% of the window height: otherwise the button column on the
// right does not fit above the profile
export const PROFILE_HEIGHT = 'min(12rem, 35dvh)';

interface StatItem {
    key: string;
    label: string;
    value: string;
}

function statItems(stats: ProfileStats): StatItem[] {
    const items: StatItem[] = [{ key: 'distance', label: 'Distance', value: kilometers(stats.distance) }];
    if (stats.noData) {
        return items;
    }
    const approx = stats.missing ? '~' : '';
    const angle = (value: ProfileStats['ascentAngle']) => (value ? `${value.avg}° / ${value.max}°` : '-');
    items.push(
        { key: 'ascent', label: 'Ascent', value: approx + meters(stats.ascent) },
        { key: 'descent', label: 'Descent', value: approx + meters(stats.descent) },
        { key: 'min', label: 'Min', value: meters(stats.min) },
        { key: 'max', label: 'Max', value: meters(stats.max) },
        { key: 'start', label: 'Start', value: (stats.approxStart ? '~' : '') + meters(stats.start) },
        { key: 'finish', label: 'Finish', value: (stats.approxEnd ? '~' : '') + meters(stats.end) },
        { key: 'ascent-slope', label: 'Avg / max ascent', value: angle(stats.ascentAngle) },
        { key: 'descent-slope', label: 'Avg / max descent', value: angle(stats.descentAngle) },
    );
    return items;
}

function Stats({ data }: { data: ProfileData }) {
    const selection = useAppStore((state) => state.profileSelection);
    const values = data.values;
    const stats = useMemo(() => {
        if (!values) {
            return null;
        }
        if (!selection) {
            return profileStats(data.samples, values);
        }
        return profileStats(data.samples, values, Math.round(selection[0]), Math.round(selection[1]));
    }, [data.samples, values, selection]);
    if (!stats) {
        return null;
    }
    let note = '';
    if (stats.noData) {
        note = 'No elevation data';
    } else if (stats.missing) {
        note = 'Some elevation data missing';
    }
    return (
        // phone: a line with scroll; computer: a column of «label — value» on the left of the graph (mock-up 4a)
        <div className="flex min-w-0 flex-nowrap items-baseline gap-x-3 overflow-x-auto whitespace-nowrap text-xs sm:flex-col sm:gap-y-1 sm:overflow-visible">
            {selection && <span className="font-medium text-amber-700">Selection</span>}
            <dl className="flex items-baseline gap-x-3 sm:grid sm:grid-cols-[auto_auto_auto_auto] sm:gap-y-0.5">
                {statItems(stats).map((item) => (
                    <div key={item.key} className="flex gap-1 sm:contents">
                        <dt className="text-muted-foreground">{item.label}</dt>
                        <dd className="font-medium tabular-nums" data-stat={item.key}>
                            {item.value}
                        </dd>
                    </div>
                ))}
            </dl>
            {note && (
                <span className="text-amber-700" data-testid="profile-note">
                    {note}
                </span>
            )}
        </div>
    );
}

// The legend of the slope steps (design slope-profile, «Легенда — шкала в строке атрибуции»): swatches in a row with
// the thresholds between them, which is shorter than a label at each step; the steps in words are in aria-label and
// title
const SLOPE_RANGES = [
    `under ${SLOPE_STEPS[0]}%`,
    ...SLOPE_STEPS.slice(1).map((step, i) => `${SLOPE_STEPS[i]}–${step}%`),
    `${SLOPE_STEPS[SLOPE_STEPS.length - 1]}% and steeper`,
];
const SLOPE_LEGEND = `Slope: ${SLOPE_RANGES.join(', ')}`;

function SlopeLegend() {
    return (
        <div
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums leading-none"
            role="img"
            aria-label={SLOPE_LEGEND}
            title={SLOPE_LEGEND}
        >
            {SLOPE_CLASSES.map((step, i) => (
                <Fragment key={step.swatch}>
                    <span className={`block h-2 w-3 rounded-[2px] ${step.swatch}`} />
                    {i < SLOPE_STEPS.length && <span>{SLOPE_STEPS[i]}</span>}
                </Fragment>
            ))}
            <span>%</span>
        </div>
    );
}

export function ElevationProfile() {
    const profile = useElevationProfile();
    const target = useAppStore((state) => state.profile);
    const data = useAppStore((state) => state.profileData);
    const track = useAppStore((state) => state.tracks.find((item) => item.id === state.profile?.trackId));
    if (!target || !track) {
        return null;
    }
    const title =
        target.segment !== null && track.segments.length > 1
            ? `${track.name}, segment ${target.segment + 1}`
            : track.name;
    const updating = data?.updating ?? true;
    return (
        <Card
            size="sm"
            // more opaque than the other glass: the graph and the numbers stay readable above a colorful map
            className="pointer-events-auto absolute inset-x-3 bottom-3 z-10 gap-1 px-3 py-2 [--glass:oklch(1_0_0/0.9)] sm:flex-row sm:gap-4"
            style={{ height: PROFILE_HEIGHT }}
            data-testid="elevation-profile"
            role="region"
            aria-label="Elevation profile"
        >
            {/* on a narrow screen the summary is a second line below the name, on a wide screen a column on the left
                of the graph */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:w-80 sm:shrink-0 sm:flex-col sm:flex-nowrap sm:items-stretch">
                <div className="flex min-w-0 flex-1 items-center gap-x-2 sm:flex-none">
                    <span
                        className="block h-1.5 w-4 shrink-0 rounded-full"
                        style={{ backgroundColor: trackColor(track.color) }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-sm" title={title}>
                        {title}
                    </span>
                    {updating && (
                        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" aria-label="Loading elevation" />
                    )}
                    {/* the panel has no close button of its own: the profile button above it (MapActions) closes
                        it, and this button is always there while the profile is open. The cross is removed after
                        user feedback (owner 2026-10-30): on a wide screen it was in the middle of the panel, and the
                        user opens the profile with the up arrow on the same button */}
                </div>
                <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto">
                    {data && <Stats data={data} />}
                </div>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
                <div className="relative min-h-0 flex-1">
                    {data?.error && (
                        <div
                            className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-destructive text-xs"
                            role="alert"
                        >
                            <span className="min-w-0 flex-1">Failed to get elevation data: {data.error}</span>
                            <Button size="xs" variant="outline" onClick={profile.retry}>
                                <RotateCwIcon />
                                Retry
                            </Button>
                        </div>
                    )}
                    {data?.values ? (
                        <ProfileGraph data={data} />
                    ) : (
                        !data?.error && (
                            <div className="flex h-full items-center justify-center text-muted-foreground text-xs">
                                Loading elevation…
                            </div>
                        )
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {/* the legend shows while the graph has a fill: without elevation data there are no sections */}
                    {data?.values && profileSections(data).length > 0 && <SlopeLegend />}
                    <a
                        className="ml-auto truncate text-[10px] text-muted-foreground leading-none hover:underline"
                        href={config.elevationsAttribution.url}
                        // on a phone the label is cut next to the legend
                        title={`Elevation data: ${config.elevationsAttribution.text}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        Elevation data: {config.elevationsAttribution.text}
                    </a>
                </div>
            </div>
        </Card>
    );
}
