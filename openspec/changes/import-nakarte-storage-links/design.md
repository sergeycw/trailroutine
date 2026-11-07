# Design

## Context

`nktl=` links of nakarte.me point to keys in the author's storage `tracks.nakarte.me`. Our app reads `nktl=` only from our Worker `nakarte-tracks`, which answers `404` for these keys. On 2026-11-07 a real key from `web/src/state/fixtures/old-links.txt` (`g9DLWicjbx6XiZ3XxP7fFw`) came back from `tracks.nakarte.me` with `200` through our CORS proxy, and the base64url md5 of the body was equal to the key. So the author's keys and ours use one scheme: one key means one body.

## Goals / Non-Goals

Goals:
- A `nktl=` link of nakarte.me opens in trailroutine, pasted in the search box or with the host replaced.
- The browser does not talk to `*.nakarte.me`, and the bundle has no author address.
- A track that opened once stays available without the author's server.

Non-goals:
- A bulk copy of the author's storage. The Worker copies only the keys that users open.
- Other `nakarte.me` services (elevation, tiles, proxy).

## Decisions

### The Worker reads the author's storage, not the browser

The fallback lives in `loadTrack` of `workers/tracks/src/index.js`. Alternatives:
- The browser asks `tracks.nakarte.me` through the CORS proxy after a `404` of our storage. Rejected: the bundle gets the author address, so the bundle check (`scripts/check-no-author-hosts.mjs`) needs an exception, and every open of the link asks the author again.
- The CORS proxy gets a route for the author's storage. Rejected: the same repeat requests, and one more contract.

With the fallback in the Worker, the app and its tests do not change, the bundle check stays strict, and the copy in R2 makes the second read local.

### Accept only a body that matches its key

The Worker accepts the author's answer only when it is `200`, at most `MAX_TRACK_BYTES`, matches `LINK_BODY`, and `trackKey(body)` equals the key. These are the same checks as for `POST`. So a broken or foreign answer cannot put a wrong body under a key, and the copy is the same track that the user shared on nakarte.me.

### Status codes

- R2 has the key: `200`, as before.
- The author answers `404`: `404`, as for any unknown key.
- Any other failure (an error status, a network error, a timeout of `NAKARTE_TIMEOUT_MS` = 5 s, a body that fails the checks): `502` and no write. A later request tries again. The app shows the same load error for `404` and `502`.

### Metadata of the copy

The copy gets `customMetadata` `{created, source: 'nakarte.me'}`. `created` is the write time, as for `POST` (requirement «Время записи»); `source` lets a listing find the copies.

## Risks / Trade-offs

- The author's server can change or close. Then new keys fail with `502`, and the copies stay. The app does not depend on it for anything else.
- Abuse: a request with a random key costs one subrequest to the author and no write, under the common rate limit of the Worker (`RATE_LIMITER`). A write happens only for a real track of the author, so its volume is bounded by what users of nakarte.me shared.
- One subrequest per unknown key fits the limit `subrequests = 10` in `wrangler.toml`.
