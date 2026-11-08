# Design

## Decisions

- **The width of the panel.** The route zone is `left-3` and `min(30rem, 100vw − 4.5rem)` (`TopBar.tsx`), so its right edge is at `100vw − 60px`. The panel starts 4 px left of the search field, at 8 px, so its width is `min(26rem, 100vw − 4.25rem)`. On a desktop the 26rem limit stays.
- **The placeholder.** On a phone of 360–375 px the field shows about 13 characters of 16 px text. `Search` fits on any phone. The full list of what the search takes is in the hint of the empty field in focus.

## Risks / Trade-offs

- The layout tests wait for a stable layout (backlog, «Интерфейс после макета 4a»), so the width has no automatic test. A screenshot at 360 px checked it.
