## ADDED Requirements

### Requirement: Relief inside OpenFreeMap Outdoor

When «Relief shading» is on and no other overlay is between it and the basemap OpenFreeMap Outdoor, the shadows SHALL be drawn inside the basemap style: above the land cover, under the water, the roads, the trails, the icons and the labels. «Relief shading» SHALL still turn the shadows on and off. With another overlay between them, the shadows SHALL stay above that overlay.

#### Scenario: Relief under the roads of the basemap

- **WHEN** the map has the basemap OpenFreeMap Outdoor and «Relief shading»
- **THEN** the shadows are above the forest and under the water, the trails and the place labels of the basemap; without «Relief shading» there are no shadows

#### Scenario: Relief above an overlay

- **WHEN** the map has the basemap OpenFreeMap Outdoor, an opaque map overlay and «Relief shading»
- **THEN** the shadows are above the overlay
