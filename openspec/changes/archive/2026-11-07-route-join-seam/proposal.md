# Proposal

## Why

After Join, the seam between the two parts was a straight leg, as in the old client, and the user could route it only by deleting one of its waypoints (design `add-web-line-tools`, «Что после операции»; Things to-do «Route the Join seam with the current activity»).

## What Changes

- After Join, the seam goes to the router with the current activity at once; the route arrives as any leg does.
- With routing off, the seam stays straight, as before.
- The seam route is not a history step: it is the answer of the router, as for any leg.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `route-editing`: «Склейка отрезков» routes the seam.

## Impact

`web/src/routing/editor.ts` (`routeLeg`), `line-tools.ts` (`joinSeam`), `editing.ts` (`join`), the browser tests of the line tools.
