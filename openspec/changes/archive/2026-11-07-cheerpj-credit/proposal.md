# Proposal

## Why

The CheerpJ Community license requires a «Built with CheerpJ» credit in the application (https://cheerpj.com/licensing/, checked 2026-11-07: attribution «Required» for Community). The clone runs the routing engine in the browser with CheerpJ and showed no credit (Things to-do «Check whether CheerpJ Community needs credit in the UI»).

## What Changes

- In the clone build (engine in the browser), the map attribution at the bottom left shows «Routing BRouter · Built with CheerpJ» with links to the BRouter repository and to cheerpj.com, next to the layer attribution.
- The local build with the server BRouter shows no credit: it does not use CheerpJ.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `browser-routing-engine`: new requirement «Built with CheerpJ credit».

## Impact

`web/src/engine/credit.ts` (new), `web/src/map/MapButtons.tsx`, a unit test.
