## ADDED Requirements

### Requirement: Finger gestures on the elevation profile

On a touch screen, a finger move on the profile graph SHALL move the cursor. A press of 500 ms without a move SHALL start a selection at the press point, and a move after it SHALL select the section to the finger. A tap or a long press without a move SHALL remove the selection. Two fingers SHALL zoom the graph horizontally 1–10× around the point between them and SHALL scroll it when they move together.

#### Scenario: Finger cursor

- **WHEN** the user puts a finger at a quarter of the graph and moves it to the half at once
- **THEN** the cursor shows 0.50 km, and there is no selection

#### Scenario: Selection with a long press

- **WHEN** the user holds a finger at a quarter of the graph for 500 ms and moves it to the half
- **THEN** the summary shows the selected section of 0.25 km; a tap on the graph returns the summary of all the profile

#### Scenario: Two-finger zoom

- **WHEN** the user puts two fingers on the graph around its middle and moves them apart to the double distance
- **THEN** the graph is two times wider, and its middle stays between the fingers
