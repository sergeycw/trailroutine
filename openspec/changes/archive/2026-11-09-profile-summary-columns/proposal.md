# Proposal

## Why

A tester (feedback 2026-11-08) reads the summary of the elevation profile by columns. The summary is a grid of four cells in a row, filled row by row. Thus the first column has Distance, Descent, Max, Finish and Avg / max descent, and the values of one kind are not near each other. The tester asked for a first column with distance, ascent, descent and so on. On 2026-11-09 the owner selected the variant «path | heights» from a sheet of four variants on the production profile.

## What Changes

- On a wide screen, the summary has two columns that read from top to bottom. The left column has the path: Distance, Ascent, Descent, Avg / max ascent, Avg / max descent. The right column has the heights: Max, Min, Start, Finish.
- The summary line on a narrow screen has the same order: the path first, then the heights.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tracks`: new requirement «Order of the profile summary».

## Impact

`web/src/elevation/ElevationProfile.tsx`, the browser test `ElevationProfile.browser.test.tsx`. The values, their labels and `data-stat` do not change.
