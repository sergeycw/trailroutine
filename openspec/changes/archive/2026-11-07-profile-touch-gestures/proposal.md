# Proposal

## Why

On a touch screen, a finger on the elevation profile only moves the cursor: the zoom works only with the mouse wheel, and the selection of a section only with a mouse drag (archive `add-web-elevation-profile`, «График: свой SVG»). The tester used the app in Chrome on an iPad (Things to-do «Add touch zoom and selection to the elevation profile»). A zoomed graph also does not scroll under a finger, because the graph has `touch-action: none`.

## What Changes

- A press of 500 ms without a move starts a selection at the press point; a move after it selects the section to the finger. A tap or a long press without a move removes the selection, as a click of the mouse.
- Two fingers zoom the graph horizontally 1–10× around the point between them and scroll it when they move together.
- A finger move without a long press moves the cursor, as before.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tracks`: new requirement «Finger gestures on the elevation profile».

## Impact

`web/src/elevation/ProfileGraph.tsx`, `web/src/elevation/ElevationProfile.browser.test.tsx`, `openspec/backlog.md`.
