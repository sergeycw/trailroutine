# Proposal

## Why

The e2e run in WebKit and Firefox (PR «run the e2e in webkit with the ipad window too») found false error reports. When a page navigates away, Safari and Firefox abort the loads in flight while the JavaScript of the page still runs:
- the move from `nakarte-routing.pages.dev` starts `location.replace` while the dynamic `import('maplibre-gl')` still loads, and Sentry gets «Importing a module script failed.» (Safari) or «error loading dynamically imported module» (Firefox);
- a reload during the engine load gives a false «BRouter engine … failed to start».

These reports use the monthly limit of Sentry (5 thousand errors) and look like real failures.

## What Changes

- The tracker drops every report after the page starts to leave: on `beforeunload`, on `pagehide`, and right before the move to the new domain.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `clone-monitoring`: new requirement «No reports after the page leaves».

## Impact

`web/src/errors/tracking.ts`, `web/src/main.tsx`, the unit test of the tracker.
