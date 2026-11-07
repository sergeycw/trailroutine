# Design

## Decisions

- **Classes from the tiles.** On 2026-11-07, z14 tiles of OpenFreeMap around Stepantsminda had the OpenMapTiles `poi` layer with `lodging/guest_house` (72), `lodging/hotel` (60), `attraction/viewpoint` (30), `campsite/camp_site` (6), `drinking_water/drinking_water` (6) and others. The icons cover the classes for a hike: `lodging` with the subclass `alpine_hut` or `wilderness_hut`, `shelter`, `campsite`, `drinking_water`, and `attraction` with the subclass `viewpoint`. The poi layer starts at zoom 14, so the style layer has `minzoom: 14`.
- **Icons drawn by the app.** A sprite would be a new file to build and host, and the style would need a `sprite` URL. Instead `layers/poi-icons.ts` draws a 24 px icon at pixel ratio 2 (a colored circle with a white border and a white sign) on a canvas. MapLibre 6 asks for a missing image through `map.setMissingStyleImageResolver`; the event `styleimagemissing` cannot add the image any more (checked: the first version with the event gave the warning «could not be loaded»). `BaseMap.tsx` sets the resolver in the callback ref, before the first tiles.
- **Names are optional.** The name under the icon uses the label rules of the style (`labelText`) and is `text-optional`: in a crowded place the icon stays and the name goes.

## Risks / Trade-offs

- The OpenMapTiles classes can change between tile builds of OpenFreeMap; then an icon disappears, and the map still works.
- Five simple signs are less detailed than a real sprite; a sprite can replace them later with the same layer.
