# Design

## Decisions

- **Overrides, not new activities.** The options are `profile:<variable>` overrides of `hiking-mountain`, the same mechanism as `Activity.params` of «Hiking, prefer trails» (`path_preference`). `withHikingOptions` in `web/src/routing/options.ts` adds them to the activity at the time of the request in `editing.ts`, so the router, the engine and the server BRouter do not change.
- **Booleans as 1 and 0.** BRouter reads a profile override as a number; `true` and `false` in a `.brf` file are 1 and 0, so the app sends `1` and `0`.
- **Only non-default values.** The query of a user who did not touch the options stays byte for byte the same as before, and the parity tests of the engine stay valid.
- **The next legs only.** A change does not reroute the existing legs, as a change of the activity does not (spec routing, «Меню активностей»): a rerouted line would surprise the user.
- **SAC 0 is not offered.** The profile value 0 («avoid any SAC paths») forbids most mountain paths; T1 covers easy routes.
- **The menu.** «Max difficulty» is a submenu, because six radio items would make the routing menu twice as long; the two check items do not close the menu, so the user can set both.

## Risks / Trade-offs

- `consider_elevation` makes BRouter prefer less climbing and can give a much longer route; the label «Avoid climbs» says what it does.
- The move from the old address does not copy the options: they are new, and the old address sends each visitor to the new domain at once.
