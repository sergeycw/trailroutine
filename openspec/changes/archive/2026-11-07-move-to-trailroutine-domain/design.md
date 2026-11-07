# Design

## Context

See proposal.md, Why. The research is in `openspec/research/trailroutine.md` (registrar, apex domain, redirect, data of users).

- One Pages project serves both host names, so both get the same build. The code must decide by `location.hostname` what to do.
- The browser keeps the data of the app per origin: the IndexedDB database `nakarte-web` (one `SavedSet` record, the autosave) and the localStorage keys `nakarte-web:*`. If the old origin has no own record, the app reads the last session of the old client once (`legacySessionSource`).
- The track storage Worker accepts any base64url text up to 2 MB under the key `base64url(md5(text))` and keeps it for ever (`workers/tracks/src/index.js`). The app already uses it for `nktl=` links (`storeTracks` in `web/src/tracks/share.ts`).
- The app strips track parameters from the address after it reads them (`web/src/state/sync.ts`).

## Goals / Non-Goals

**Goals:**

- A visitor of the old address lands on the new domain with the same fragment, tracks and settings, without a click.
- The server cannot read the moved data.
- A failure keeps every piece of data where it is.

**Non-Goals:**

- The Bulk Redirect of `nakarte-routing.pages.dev` (a later step, backlog).
- A move of the data of the old client on `nakarte.me`: that origin is not ours.
- New names for the Workers and buckets `nakarte-*`.

## Decisions

### Move the data through the track storage, encrypted

The options were:

1. The data in the URL fragment of the redirect. No server, but the URL length limits of browsers are not documented in primary sources. Secondary sources give about 80 000 characters for Safari, and a few thousand track points after compression come close to that. A failed navigation leaves the user with nothing.
2. A hidden iframe of the old origin inside the new site, with `postMessage`. Browsers partition the storage of third-party iframes: since Chrome 115 the iframe sees an empty storage ([storage partitioning](https://privacysandbox.google.com/3pcd/storage-partitioning)).
3. A popup of the new domain, opened by the old page, with `postMessage`. It needs a click, because browsers block popups without a user gesture.
4. The data in the track storage. One `POST` of up to 2 MB, then a normal navigation with a short fragment.

Option 4 is the only one that works without a click and without a size limit that we cannot check. The old page compresses the payload (`CompressionStream('gzip')`) and encrypts it with AES-GCM and a random 256-bit key (WebCrypto). It stores `base64url(iv + ciphertext)` with the same key function as `nktl=` links. The fragment gets `move=<storage key>.<base64url(encryption key)>`. A fragment does not go to the server, so the Worker and its logs never see the encryption key. The stored object stays in R2 for ever, but it is ciphertext.

The Worker does not change, except `ALLOWED_ORIGINS`.

### Payload

`{ "v": 1, "tracks": SavedTrack[], "settings": { key: value } }`:

- `tracks` is the `SavedSet.tracks` of the old origin, with `Float64Array` written as number arrays. JSON keeps a float64 exactly, so no coordinate changes. If the old origin has no own record, the tracks come from the last session of the old client, through the same `prepareImport` and `toSaved` path as the autosave restore.
- `settings` are the localStorage values of an allowlist: `nakarte-web:layers`, `nakarte-web:position`, `nakarte-web:routing-activity`, `nakarte-web:recent-colors`, and the keys of the old client that the app still reads: `leafletLayersSettings`, `leaflet_locate_position`, `trackListRoutingActivity`. The values are copied as strings. Each reader already parses its key defensively.

### Before the app starts

Both directions run in `web/src/main.tsx` before React renders:

- The old origin does not render the app when the move succeeds. This prevents a flash of the old app and any write to its storage.
- The new origin writes the moved tracks into IndexedDB before the autosave restore reads it. The restore then shows them as saved tracks, with no new code in the store.

The cost is a blank page while the `POST` or `GET` runs. Both have a timeout of 10 s.

### Each move is imported once

- The old origin remembers the `move` value in localStorage (`nakarte-web:moved`). Later visits reuse it and do not upload again.
- The new origin keeps the list of imported storage keys (`nakarte-web:moved-in`) and skips a key from the list.
- If the user clears the storage of the new domain, the list is gone too. A later visit to the old address then imports the data again, which is what the user wants.

### Settings only from the old address

A link `https://trailroutine.com/#move=…` can come from any site. Moved tracks are like `nktl=` tracks: any link can add tracks, and the user sees them. Settings are different: `nakarte-web:layers` can hold custom layers with any tile URL. So the new domain copies settings only when `document.referrer` has the origin of the old address. The old page navigates with `location.replace`, and the default referrer policy (`strict-origin-when-cross-origin`) sends the origin. A setting is copied only when the new domain has no value for it.

### Failure

- Old origin: if reading, encrypting or uploading fails, the app renders on the old address as before, without a toast. Nothing is remembered, so the next visit tries again.
- New origin: if loading or decrypting fails, the app starts with its own data and shows the toast `Could not move tracks from nakarte-routing.pages.dev`. `App` gets the text as a prop and shows it after mount, because the toast manager has no listener before the `Toaster` mounts.

### Configuration

`web/src/config.ts` gets `siteOrigin` (`https://trailroutine.com`) and `movedFromHosts` (`['nakarte-routing.pages.dev']`). Only this exact host moves. Deployment and branch addresses `<hash>.nakarte-routing.pages.dev` and the future staging project do not move.

### e2e on real host names

The e2e test routes `https://nakarte-routing.pages.dev/**` and `https://trailroutine.com/**` to `vite preview` (`context.route` and `route.fetch`). Each host name is then its own origin with its own storage, as in production. The test writes the autosave record and settings on the old origin from a stub page, opens the old address and checks the track list and the settings on the new domain. The track storage is the in-memory stub of the `network` fixture.

### Domain and DNS

The custom domain is added to the Pages project through the Pages API with the OAuth token of wrangler. The token has no DNS scope, so the proxied CNAME `trailroutine.com → nakarte-routing.pages.dev` is added in the dashboard. Cloudflare did not create it when the domain was added through the API.

## Risks / Trade-offs

- [The `move` value in the address of the new page.] → The app removes it with `history.replaceState` before it renders, so it does not stay in the history. The old page uses `location.replace`, so the old address does not stay in the history either.
- [The track storage gets objects that never expire.] → One object per user that moves, up to 2 MB, under the existing write limit per IP.
- [A browser without `CompressionStream` (Safari before 16.4).] → The move fails on the old address, and the app works there as before.
- [Sentry drops errors from the new domain.] → The owner adds `trailroutine.com` to Allowed Domains of the Sentry project.
- [The Google Maps key has a referrer list without the new domain.] → Street View falls back to its error toast. Check on the new domain after the deploy, and the owner adds the domain if needed.

## Migration Plan

1. Merge: the Workers deploy first with the new origin, then Pages with the move code (`deploy-pages.yml` already deploys Workers before Pages).
2. Check on production: `prod-check.sh` passes on both addresses, and a browser profile with data on the old address lands on the new domain with the data.
3. Rollback: revert the merge commit. The old address then renders the app again. Data that already moved stays on the new domain.
