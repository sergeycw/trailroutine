import { expect, test } from 'vitest';
import { fixtureBytes } from '@/test/bytes';
import oldParsers from '../fixtures/old-parsers.json';
import type { GeoData } from '../model';
import { parseGeoFile } from '.';

// Parser scenarios on fixtures, shared by unit tests in Node (DOMParser from xmldom) and browser tests in Chromium: a
// difference between the two DOMParsers on these files fails one of the runs (design add-web-tracks, «Парсеры»).

const FILES = import.meta.glob<string>('../fixtures/files/*', { query: '?bytes', import: 'default', eager: true });

function file(name: string): Uint8Array {
    const base64 = FILES[`../fixtures/files/${name}`];
    if (base64 === undefined) {
        throw new Error(`нет фикстуры ${name}`);
    }
    return fixtureBytes(base64);
}

function parse(name: string): GeoData[] {
    return parseGeoFile(name, file(name));
}

function shape(data: GeoData) {
    return {
        name: data.name,
        error: data.error,
        segments: data.segments.map((line) => line.length),
        points: data.points.map((point) => point.name),
    };
}

interface OldGeoData {
    name: string;
    error?: string;
    tracks?: { lat: number; lng: number }[][];
    points?: { lat: number; lng: number; name: string }[];
}

export function parserCases() {
    // the behavior of the old client on these files is the requirement (fixtures/README.md)
    test.each(Object.entries(oldParsers as Record<string, OldGeoData[]>))('как старый клиент: %s', (name, expected) => {
        const actual = parse(name).map((data) => ({
            name: data.name,
            error: data.error,
            tracks: data.segments,
            points: data.points,
        }));
        expect(actual).toEqual(
            expected.map((old) => ({
                name: old.name,
                error: old.error,
                tracks: old.tracks ?? [],
                points: (old.points ?? []).map(({ lat, lng, name: pointName }) => ({ lat, lng, name: pointName })),
            })),
        );
    });

    test('Открыть GPX', () => {
        expect(parse('track_service_prototype_full.gpx').map(shape)).toEqual([
            {
                name: 'track_service_prototype_full.gpx',
                error: undefined,
                segments: [3, 4],
                points: ['Point 1', 'Точка 2'],
            },
        ]);
    });

    test('Архив с несколькими файлами', () => {
        // readme.txt and the directory are skipped; both names are read: the name in CP866 without the UTF-8 flag and
        // the name with the flag
        expect(parse('archive.zip').map(shape)).toEqual([
            { name: 'трек.gpx', error: undefined, segments: [2], points: [] },
            { name: 'track.plt', error: undefined, segments: [2, 2], points: [] },
            { name: 'юникод.gpx', error: undefined, segments: [2], points: [] },
        ]);
    });

    test('Кириллица в Windows-1251: GPX', () => {
        const [track] = parse('cp1251.gpx');
        expect(shape(track)).toEqual({ name: 'cp1251.gpx', error: undefined, segments: [2], points: ['Перевал'] });
    });

    test('Кириллица в Windows-1251: Ozi wpt', () => {
        expect(parse('points.wpt')[0].points.map((point) => point.name)).toEqual(['Перевал', 'Hut 2']);
    });

    test('Неизвестный формат', () => {
        expect(parse('unknown.txt')).toEqual([{ name: 'unknown.txt', segments: [], points: [], error: 'UNSUPPORTED' }]);
    });

    test('Испорченный трек', () => {
        const [track] = parse('corrupt.gpx');
        expect(track.error).toBe('CORRUPT');
        expect(track.segments).toEqual([
            [
                { lat: 41.7, lng: 44.8 },
                { lat: 41.71, lng: 44.81 },
            ],
        ]);
    });

    test('KML: LineString, gx:Track, точки и сущность в названии', () => {
        const [track] = parse('lines.kml');
        expect(shape(track)).toEqual({
            name: 'lines.kml',
            error: undefined,
            segments: [3, 2],
            points: ['Вершина & хижина'],
        });
        expect(track.segments[1][0]).toEqual({ lat: 41.6, lng: 44.7 });
    });

    test('KMZ — один трек из всех .kml архива', () => {
        expect(parse('track.kmz').map(shape)).toEqual([
            { name: 'track.kmz', error: undefined, segments: [3, 2, 2], points: ['Вершина & хижина'] },
        ]);
    });

    test('GeoJSON MultiLineString', () => {
        expect(parse('multi.geojson').map(shape)).toEqual([
            { name: 'multi.geojson', error: undefined, segments: [2, 2], points: [] },
        ]);
    });

    test('пустой файл — трек без данных, без ошибки', () => {
        expect(parse('empty.gpx').map(shape)).toEqual([
            { name: 'empty.gpx', error: undefined, segments: [], points: [] },
        ]);
    });
}
