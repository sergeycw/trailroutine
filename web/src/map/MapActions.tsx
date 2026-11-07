import { ChevronDownIcon, ChevronUpIcon, MountainIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useElevationProfile } from '@/elevation/context';
import { meters } from '@/elevation/format';
import { profileStats } from '@/elevation/profile';
import { ImageryDateButton } from '@/layers/ImageryDate';
import { useAppStore } from '@/state/context';
import type { AppState } from '@/state/store';
import { formatLength, tracksLength } from '@/tracks/geometry';

// The elevation profile button at the bottom center (three zones, design layout-three-zones): the profile opens by a
// button, as in MapMagic (mockup 4a). It is above the bottom panels (--bottom-inset), the toasts are above it. No
// label: the length and the ascent are data, the name is in title and in hidden text.

const hasLines = (segments: readonly (readonly unknown[])[]) => segments.some((segment) => segment.length > 1);

// The active route: the edited track, otherwise the track with an open profile, if it has lines (research user-flows,
// «Раскладка: три зоны»). The rule "otherwise the first visible track" no longer exists: it was not clear which track
// the button showed
function profileTrackId(state: AppState): string | null {
    const candidates = [
        state.tracks.find((track) => track.id === state.routeEdit?.trackId),
        state.tracks.find((track) => track.id === state.profile?.trackId),
    ];
    return candidates.find((track) => track && hasLines(track.segments))?.id ?? null;
}

function ProfileButton() {
    const profile = useElevationProfile();
    const trackId = useAppStore(profileTrackId);
    const track = useAppStore((state) => state.tracks.find((item) => item.id === trackId));
    // the profile of this track is open: when A is in edit and the profile of B is open, the button of A is collapsed
    // and opens the profile of A
    const open = useAppStore((state) => trackId !== null && state.profile?.trackId === trackId);
    // the ascent comes only from the already calculated profile of the full track: a request of elevations for the
    // label would spend the elevation API limit
    const data = useAppStore((state) =>
        state.profile?.trackId === trackId && state.profile.segment === null ? state.profileData : null,
    );
    const ascent = useMemo(() => {
        if (!data?.values) {
            return null;
        }
        const stats = profileStats(data.samples, data.values);
        return stats.noData ? null : stats.ascent;
    }, [data]);
    if (!track) {
        return null;
    }
    return (
        // the name is the hidden "Elevation profile" and the visible length and ascent, not aria-label: aria-label
        // would hide the data from a screen reader (WCAG 2.5.3, the visible text is part of the name)
        <button
            type="button"
            className="glass pointer-events-auto flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-3.5 font-medium text-sm tabular-nums transition-colors hover:bg-white/90 [&_svg]:size-4 [&_svg]:shrink-0"
            aria-expanded={open}
            title="Elevation profile"
            onClick={() => (open ? profile.close() : profile.open(track.id))}
        >
            <MountainIcon aria-hidden="true" />
            <span className="sr-only">Elevation profile</span>
            {formatLength(tracksLength(track.segments))}
            {ascent !== null && <span className="font-normal text-muted-foreground">↑ {meters(ascent)}</span>}
            {open ? (
                <ChevronDownIcon className="opacity-60" aria-hidden="true" />
            ) : (
                <ChevronUpIcon className="opacity-60" aria-hidden="true" />
            )}
        </button>
    );
}

// fetch is the network for imagery dates (Earth Search): browser tests give their own, as for TopBar
export function MapActions({ fetch }: { fetch: typeof window.fetch }) {
    const shown = useAppStore(
        (state) => profileTrackId(state) !== null || state.layers.get(state.selection.base)?.dated === true,
    );
    // the expanded attribution with the scale bar at the bottom left goes above the buttons while they are present
    // (index.css): a long attribution of several layers reaches the window center
    useEffect(() => {
        if (!shown) {
            return;
        }
        const root = document.documentElement;
        root.style.setProperty('--profile-button-inset', '3.25rem');
        return () => {
            root.style.removeProperty('--profile-button-inset');
        };
    }, [shown]);
    return (
        <div
            className="pointer-events-none absolute right-3 bottom-[calc(var(--bottom-inset)+0.75rem)] left-3 z-10 flex justify-center gap-2"
            data-testid="map-actions"
        >
            <ImageryDateButton fetch={fetch} />
            <ProfileButton />
        </div>
    );
}
