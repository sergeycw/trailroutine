# Proposal

## Why

The backlog item «Настройки активности в UI» asks for the SAC scale, `consider_elevation` and `allow_steps` of the hiking profile (Things to-do «Add activity settings for SAC scale, elevation and steps»). Today the hiking activities use the profile defaults: paths up to SAC T3, no preference for less climbing, steps allowed. A hiker who wants an easy route or no stairs has no way to say it.

## What Changes

- The routing menu shows a group «Hiking» when the activity uses the profile `hiking-mountain` (Hiking, Hiking prefer trails): a submenu «Max difficulty» with SAC T1–T6, and the check items «Avoid climbs» and «Allow steps».
- The options go into the BRouter query as profile overrides (`profile:SAC_scale_limit`, `profile:consider_elevation`, `profile:allow_steps`). A default value is not sent, so the default query does not change.
- The options apply to the legs that are routed after the change, as a change of the activity does, and they stay after a reload (`localStorage` key `nakarte-web:hiking-options`).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `routing`: new requirement «Hiking options».

## Impact

`web/src/routing/options.ts` (new), `editing.ts`, `RoutingButton.tsx`, `web/src/state/store.ts`, `web/src/state/sync.ts`, tests.
