import type { Activity } from './brouter';

// Options of the hiking profile hiking-mountain (spec routing, «Hiking options»; change hiking-options): the hardest SAC
// scale that a route may use, the wish to avoid climbs, and steps. They are overrides of profile variables, the same
// profile:<name>=<value> as Activity.params. The defaults are the defaults of the profile, and a default value is not
// sent: the query stays the same as without options (the server BRouter and the engine give the same route).

export interface HikingOptions {
    // SAC_scale_limit: paths harder than this are forbidden, 1 = T1 … 6 = T6
    sacLimit: number;
    // consider_elevation: prefer a route with less climbing
    avoidClimbs: boolean;
    // allow_steps
    allowSteps: boolean;
}

export const HIKING_PROFILE = 'hiking-mountain';
export const DEFAULT_HIKING_OPTIONS: HikingOptions = { sacLimit: 3, avoidClimbs: false, allowSteps: true };
export const SAC_LEVELS = [
    { value: 1, title: 'T1 · hiking' },
    { value: 2, title: 'T2 · mountain hiking' },
    { value: 3, title: 'T3 · demanding mountain hiking' },
    { value: 4, title: 'T4 · alpine hiking' },
    { value: 5, title: 'T5 · demanding alpine hiking' },
    { value: 6, title: 'T6 · difficult alpine hiking' },
] as const;

const STORAGE_KEY = 'nakarte-web:hiking-options';

function valid(value: unknown): HikingOptions | null {
    const options = value as Partial<HikingOptions> | null;
    if (
        !options ||
        !Number.isInteger(options.sacLimit) ||
        (options.sacLimit as number) < 1 ||
        (options.sacLimit as number) > 6 ||
        typeof options.avoidClimbs !== 'boolean' ||
        typeof options.allowSteps !== 'boolean'
    ) {
        return null;
    }
    return { sacLimit: options.sacLimit as number, avoidClimbs: options.avoidClimbs, allowSteps: options.allowSteps };
}

export function loadHikingOptions(storage: Storage | null): HikingOptions {
    try {
        const text = storage?.getItem(STORAGE_KEY);
        return (text && valid(JSON.parse(text))) || DEFAULT_HIKING_OPTIONS;
    } catch {
        return DEFAULT_HIKING_OPTIONS;
    }
}

export function saveHikingOptions(storage: Storage | null, options: HikingOptions): void {
    try {
        storage?.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch {
        // the storage is not available or is full: the options live until a reload
    }
}

// The activity with the options as profile overrides; other profiles do not have these variables and stay as they are
export function withHikingOptions(activity: Activity, options: HikingOptions): Activity {
    if (activity.profile !== HIKING_PROFILE) {
        return activity;
    }
    const params: [string, number][] = [];
    if (options.sacLimit !== DEFAULT_HIKING_OPTIONS.sacLimit) {
        params.push(['SAC_scale_limit', options.sacLimit]);
    }
    if (options.avoidClimbs !== DEFAULT_HIKING_OPTIONS.avoidClimbs) {
        params.push(['consider_elevation', options.avoidClimbs ? 1 : 0]);
    }
    if (options.allowSteps !== DEFAULT_HIKING_OPTIONS.allowSteps) {
        params.push(['allow_steps', options.allowSteps ? 1 : 0]);
    }
    return params.length ? { ...activity, params: [...(activity.params ?? []), ...params] } : activity;
}
