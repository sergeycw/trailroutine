# Proposal

## Why

The tile server `tiles.slazav.xyz` of the layers Slazav mountains (`Q`) and Slazav Moscow region map (`Z`) stopped working on 2026-11-07. First it did not answer, directly or through the proxy. After it came back on 2026-11-08, it answers `404` for every tile at every zoom, also in Moscow, while slazav.xyz/maps still lists the same tile addresses. The weekly check `layer tiles check` found it. A user who turns on these layers sees an empty map. The owner decided to remove the layers.

## What Changes

- The catalog has no `Q` and `Z` any more. An old link or saved settings with these codes open without them: the app skips unknown codes, as for the other removed layers.
- The weekly tile check does not request them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-layers`: requirement «Каталог слоёв» — two more excluded layers, the count of the list.

## Impact

`web/src/layers/catalog.ts`, `scripts/layer-tiles-check.mjs`, tests (`catalog.test.ts`, `e2e/map-layers.spec.ts`), `AGENTS.md`, `openspec/backlog.md`. To bring the layers back, revert the PR of this change.
