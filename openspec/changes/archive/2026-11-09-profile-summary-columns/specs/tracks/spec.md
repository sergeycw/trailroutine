## ADDED Requirements

### Requirement: Order of the profile summary

On a wide screen, the profile summary SHALL show the values in two columns that read from top to bottom. The left column SHALL show the path: the distance, the ascent, the descent and the slopes of the ascent and of the descent. The right column SHALL show the heights: the maximum, the minimum, the start and the finish. The summary line on a narrow screen SHALL use the same order: the path first, then the heights.

#### Scenario: Order of the summary

- **WHEN** the user opens the profile of a track on a wide screen
- **THEN** the left column shows from top to bottom Distance, Ascent, Descent, Avg / max ascent, Avg / max descent, and the right column shows Max, Min, Start, Finish
