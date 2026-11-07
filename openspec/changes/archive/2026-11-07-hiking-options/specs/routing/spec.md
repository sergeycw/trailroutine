## ADDED Requirements

### Requirement: Hiking options

For an activity with the profile `hiking-mountain`, the routing menu SHALL show a group «Hiking»: «Max difficulty» with SAC T1–T6 (default T3), «Avoid climbs» (default off) and «Allow steps» (default on). A changed option SHALL go into the BRouter query of the next routed legs as `profile:SAC_scale_limit`, `profile:consider_elevation` or `profile:allow_steps`; a default value SHALL NOT be sent. The options SHALL stay after a reload.

#### Scenario: Option applies to the next leg

- **WHEN** the activity is Hiking, the user turns on «Avoid climbs», turns off «Allow steps», chooses T5, and draws a new leg
- **THEN** the request of the leg has `profile:SAC_scale_limit=5`, `profile:consider_elevation=1` and `profile:allow_steps=0`, and the options are in `localStorage`

#### Scenario: Options only for hiking

- **WHEN** the activity is Gravel bike and the user opens the routing menu
- **THEN** the menu has no group «Hiking»
