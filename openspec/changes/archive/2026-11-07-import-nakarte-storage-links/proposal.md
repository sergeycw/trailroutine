# Proposal

## Why

A tester reported on 2026-11-07 that links from nakarte.me do not open (backlog, «Отзывы пользователей»). A nakarte.me link with `nktl=` has only a key. The track for that key is in the author's storage `tracks.nakarte.me`, but the app looks for it in our storage `nakarte-tracks`, which answers `404`. People who move from nakarte.me bring exactly these links. The owner decided on 2026-11-07 to read such tracks from the author's storage.

## What Changes

- The track storage Worker `nakarte-tracks` reads a key that is not in R2 from `https://tracks.nakarte.me/track/{key}`. The author's key is the same base64url md5 of the body as ours (checked on a real key on 2026-11-07), so the Worker accepts the body only when it matches the key and is a link body. Then it keeps a copy in R2 and returns the track.
- The app does not change: it asks our storage as before, and the `nktl=` link opens. The bundle check stays as it is, because the bundle gets no new address of the author.
- A track that the Worker copied stays available when the author's storage is down or closed.
- The README, the architecture docs and the backlog no longer say that these links do not open.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `track-storage`: a key that is not in R2 comes from the author's storage, with a check of the body and a copy in R2 (new requirement).
- `clone-hosting`: the own track storage reads unknown keys from the author's storage; the rule «no requests to the author's infrastructure» gets this one exception, made by the Worker and not by the browser.

## Impact

- `workers/tracks/src/index.js`, its tests and `vitest.config.js` (a stub of the author's storage).
- One subrequest per unknown key, under the existing rate limit of the Worker.
- Docs: `README.md`, `docs/architecture/track-storage.md`, `docs/architecture/protection.md`, `docs/architecture/decisions.md`, `openspec/backlog.md`.
