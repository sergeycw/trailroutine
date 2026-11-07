# Proposal

## Why

The overlay «Relief shading» (`Hs`) is on by default and is drawn above all layers of the basemap. On the default basemap OpenFreeMap Outdoor (`Of`) the shadows also darken the roads, the trails, the water and the labels. The backlog asks to draw the relief inside the `Of` style instead (Things to-do «Move hillshade into the OpenFreeMap Outdoor style»).

## What Changes

- When `Hs` is right above the vector basemap `Of`, its hillshade layer goes inside the `Of` style: above the land cover, under the water, the roads, the trails, the POI icons and the labels.
- The toggle «Relief shading» stays: without `Hs` there is no relief, and there is no second relief layer.
- When another overlay is between `Of` and `Hs` (an opaque map of the catalog or a custom layer), the relief stays at its catalog place above that overlay, as on the other basemaps.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-layers`: new requirement «Relief inside OpenFreeMap Outdoor».

## Impact

`web/src/layers/style.ts` (`buildStyle`), `web/src/layers/outdoor.ts` (`outdoorLayers` gets the relief layers), `web/src/test/render-app.tsx` (`mapLayerIds`), tests.
