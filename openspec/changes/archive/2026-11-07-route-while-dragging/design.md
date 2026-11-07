# Design

## Decisions

- **A pause, not a rate.** A request per mouse move would fill the engine queue: the in-browser engine needs 0.3–0.5 s per leg (backlog, «Варианты движка в браузере»). The app waits until the pointer rests for `DRAG_ROUTE_DELAY_MS` = 300 ms, so the engine gets one pair of requests per pause, and a move aborts the pair in flight.
- **The same router, a separate kind.** `Router.route` gets an optional fifth argument `kind: 'preview'`. The engine and the server ignore it; the fake router of the browser tests keeps such calls in `previews`, so the tests that count the routes of the line do not change.
- **No reuse of the preview on drop.** The drop routes the legs as before (`editor.moveWaypoint`): the editor keeps one path for routes, history and stale answers. The cost is one more pair of requests after a pause.
- **Activity and options.** `editing.previewRoute` uses the current activity and the hiking options, as the line does.

## Risks / Trade-offs

- On a slow engine the routed preview comes late; until then the user sees straight lines, as before.
