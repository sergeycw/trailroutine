import { simplifyRouted } from '@/routing/line';
import { normalizeLine } from './geometry';
import { type GeoData, isEmpty } from './model';

// What from the loaded data goes into the list and which messages to show (addTracksFromGeodataArray of the old client;
// the texts: spec track-files, «Сообщение об ошибке источника»).

const ERROR_MESSAGES: Record<string, string> = {
    CORRUPT: 'File "{name}" is corrupt',
    UNSUPPORTED: 'File "{name}" has unsupported format or is badly corrupt',
    NETWORK: 'Could not download file from url "{name}"',
    INVALID_URL: '"{name}" is not of supported URL type',
};

export interface ImportResult {
    tracks: GeoData[];
    messages: string[];
}

// allowEmpty: add an empty track too («New track»)
export function prepareImport(data: readonly GeoData[], allowEmpty = false): ImportResult {
    const result: ImportResult = { tracks: [], messages: [] };
    if (data.length === 0) {
        result.messages.push('No tracks loaded');
    }
    for (const item of data) {
        const empty = isEmpty(item);
        if (!empty || allowEmpty) {
            // lines are simplified; a segment with route markup (an nktk link) keeps its waypoints, and the indexes in
            // the markup are calculated again (design add-web-autosave, «Упрощение линии не трогает опорные точки»)
            const { routes, ...rest } = item;
            const lines = item.segments.map(
                (line, i) => simplifyRouted(line, routes?.[i]) ?? { points: normalizeLine(line), route: null },
            );
            result.tracks.push({
                ...rest,
                segments: lines.map((line) => line.points),
                ...(lines.some((line) => line.route) ? { routes: lines.map((line) => line.route) } : {}),
            });
        }
        let message: string | undefined;
        if (item.error) {
            message = ERROR_MESSAGES[item.error] ?? item.error;
            message += empty ? ', no data could be loaded' : ', loaded data can be invalid or incomplete';
        } else if (empty && !allowEmpty) {
            message = 'No data could be loaded from file "{name}". File is empty or contains only unsupported data.';
        }
        if (message) {
            result.messages.push(message.replaceAll('{name}', item.name));
        }
    }
    return result;
}
