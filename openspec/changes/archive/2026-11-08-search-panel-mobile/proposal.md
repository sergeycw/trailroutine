# Proposal

## Why

On a phone (owner screenshot 2026-11-08), the hint panel under the search bar covers the column of the map buttons on the right, and the placeholder `Search or paste a track link` does not fit into the search field.

## What Changes

- The panel under the search bar (the hint, the results, the messages) ends at the right edge of the route zone, as the top bar does, so it does not cover the column of the map buttons.
- The placeholder is `Search`. The hint under the empty field in focus and the tooltip of the field list the places, coordinates and links, as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-search`: requirement «Строка поиска» — the placeholder; new requirement «Search panel on a narrow screen».

## Impact

`web/src/search/SearchBox.tsx`.
