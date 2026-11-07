# Design

## Decisions

- **Where.** The map attribution (`AttributionControl` with `customAttribution` in `MapButtons.tsx`) is the place where the app credits its data and tools; it is visible on load and folds into (i) after a move (design map-chrome). The license does not say where the credit goes.
- **Only in the clone.** `routingAttribution(config.routingEngine)` in `web/src/engine/credit.ts` returns the credit for the engine in the browser and nothing for the server BRouter, so the attribution tests of the layers (they run in the server mode) do not change.
