import type { ProfileData } from '@/state/store';
import { distanceAt, type Elevation, elevationAt, type SlopeSection, sectionAt, slopeSections } from './profile';

// The profile texts: meters as integers, kilometers with two decimals, as in the old client (updatePropsDisplay,
// setCursorPosition)

export const meters = (value: number) => `${Math.round(value)} m`;
export const kilometers = (value: number) => `${(value / 1000).toFixed(2)} km`;

// The slope sections of the profile are computed one time per elevation array: the cursor calls cursorInfo on each
// mouse move, and the array values changes only when the profile is built again (together with samples,
// controller.ts)
const sectionsCache = new WeakMap<readonly Elevation[], SlopeSection[]>();

export function profileSections(data: ProfileData): SlopeSection[] {
    const values = data.values ?? [];
    let sections = sectionsCache.get(values);
    if (!sections) {
        sections = slopeSections(data.samples, values);
        sectionsCache.set(values, sections);
    }
    return sections;
}

export interface CursorInfo {
    elevation: string;
    distance: string;
    // the grade of the colored section with an arrow: «↑ 12%», «↓ 4%», «0%»; «-» outside the sections (design
    // slope-profile, «Курсор»)
    slope: string;
}

export function cursorInfo(data: ProfileData, index: number): CursorInfo {
    const { samples } = data;
    const values = data.values ?? [];
    const height = elevationAt(values, index);
    const section = sectionAt(profileSections(data), index);
    let slopeText = '-';
    if (section) {
        // round the absolute value, as in slopeClass: Math.round(-2.5) = -2, but the grade −2.5 % is in the step 3–6
        const percent = Math.round(Math.abs(section.grade));
        const arrow = percent === 0 ? '' : section.grade > 0 ? '↑ ' : '↓ ';
        slopeText = `${arrow}${percent}%`;
    }
    return {
        elevation: height === null ? '-' : meters(height),
        distance: kilometers(distanceAt(samples.distances, index) - samples.distances[0]),
        slope: slopeText,
    };
}
