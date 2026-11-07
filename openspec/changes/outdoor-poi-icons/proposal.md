# Proposal

## Why

The backlog item of the basemap OpenFreeMap Outdoor (`Of`) lists POI icons as the next step: huts, springs and shelters, which a hiker looks for (Things to-do «Add POI icons to the OpenFreeMap Outdoor style»). The style has no sprite, so it has no icons at all.

## What Changes

- From zoom 14, `Of` shows icons for alpine and wilderness huts, shelters, campsites, drinking water and viewpoints, with the name under the icon when there is space.
- The app draws each icon on a canvas when MapLibre asks for it (`map.setMissingStyleImageResolver`): no sprite and no icon requests, so the requirement «без шрифтов и значков с других адресов» holds.
- Hotels, guest houses, shops and other POI classes get no icon.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-layers`: «Подложка OpenFreeMap Outdoor» gets the POI icons.

## Impact

`web/src/layers/poi-icons.ts` (new), `web/src/layers/outdoor.ts`, `web/src/map/BaseMap.tsx`, tests.
