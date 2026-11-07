import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { cleanup } from 'vitest-browser-react';
import '@/index.css';
import { renderApp } from '@/test/render-app';
import { type FixtureTiles, fixtureTiles } from '@/test/tiles';
import { MOVE_FAILED } from './move-in';

// main.tsx passes the result of moveIn to App as notice (spec clone-hosting, «Import of moved data»)

let tiles: FixtureTiles;

beforeEach(() => {
    localStorage.clear();
    tiles = fixtureTiles();
});

afterEach(async () => {
    await cleanup();
    expect(tiles.external, 'requests past localhost and the tiles').toEqual([]);
});

describe('Import of moved data', () => {
    test('Import fails', async () => {
        await renderApp(tiles, '', { notice: MOVE_FAILED, tracksOpen: false });
        await expect.element(page.getByText(MOVE_FAILED)).toBeVisible();
        expect(page.getByText(MOVE_FAILED).all()).toHaveLength(1);
    });

    test('no notice, no toast', async () => {
        await renderApp(tiles, '', { tracksOpen: false });
        expect(page.getByText(MOVE_FAILED).all()).toHaveLength(0);
    });
});
