# Proposal

## Why

When the user drags a waypoint, the preview shows straight lines to the neighbour waypoints, and the route appears only after the drop. The backlog asks to route the line during the drag, with a limit on the request rate (Things to-do «Re-route the line while the user drags a waypoint»). Then the user sees where the trail goes before letting go.

## What Changes

- During a drag, when the pointer rests for 300 ms, the app routes the two neighbour legs to the current point with the current activity and options, and the preview shows the routed legs. A move drops the requests in flight and shows straight lines again until the next pause.
- The preview routes do not change the line or its history; the drop routes the legs as before.
- With routing off or on a routing error, the preview stays straight.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `route-editing`: new requirement «Route preview during a drag».

## Impact

`web/src/routing/MapEditor.tsx`, `routing/editing.ts` (`previewRoute`), `routing/router.ts` (an optional kind `preview` of a route), `web/src/test/fake-router.ts`, tests.
