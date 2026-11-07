# Design

## Decisions

- **The same `Hs` layer, at another place.** `buildStyle` gives the hillshade layer of `Hs` to `outdoorLayers`, which puts it after `<code>-landcover`. The layer id, the source and the paint stay the same, so the tile errors, the attribution and the toggle work as before. A separate relief source inside the `Of` style would double the requests of the DEM tiles when `Hs` is on, and would need a second toggle.
- **The slot.** Above the land cover fills, so the shadows fall on the forest and the meadows. Under the water fill, so the lakes stay flat. Under the lines and the labels, so they keep their colors.
- **Only right above the basemap.** The basemap is always first in the sorted layers. When the next layer is `Hs`, the relief goes inside. An overlay between them covers the basemap, and the relief inside the basemap would be under that overlay, so the relief keeps its catalog place there.
- **`mapLayerIds` of the browser tests** counts each code once, at the place of its first layer. The style layers of `Of` are now not consecutive (`Of-…`, `Hs`, `Of-…`), and the tests check which layers are on, not how the style is made.

## Risks / Trade-offs

- With a vector basemap and the relief inside, the order in the style differs from the catalog order. Only `buildStyle` knows this; the layer list in the UI does not change.
