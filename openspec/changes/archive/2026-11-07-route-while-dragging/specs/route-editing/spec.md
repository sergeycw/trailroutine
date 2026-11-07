## ADDED Requirements

### Requirement: Route preview during a drag

When the pointer rests for 300 ms during a drag of a waypoint, the app SHALL route the neighbour legs to the current point with the current activity and options and SHALL show them in the drag preview. A new move SHALL cancel these requests and show straight lines until the next pause. The preview routes SHALL NOT change the line or its history. With routing off or on an error, the preview SHALL stay straight.

#### Scenario: Route preview during a drag

- **WHEN** the user drags the middle waypoint of a routed line and keeps the pointer still
- **THEN** the two neighbour legs are routed to the pointer and the preview draws them; the line gets no new routes until the drop, and the drop routes the two legs as before
