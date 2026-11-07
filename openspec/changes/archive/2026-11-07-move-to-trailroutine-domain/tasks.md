# Tasks

## 1. Domain and Workers

- [x] 1.1 Add `trailroutine.com` to the Pages project `nakarte-routing` (Pages API) and add the proxied CNAME `trailroutine.com → nakarte-routing.pages.dev` in the zone. Verify: the Pages API shows the domain as `active`, and `curl -I https://trailroutine.com/` answers `200`.
- [x] 1.2 Add `https://trailroutine.com` to `ALLOWED_ORIGINS` in `workers/cors-proxy/wrangler.toml`, `workers/tracks/wrangler.toml` and `workers/elevation/wrangler.toml`, and add `trailroutine.com` to `OWN_HOSTS` in `workers/cors-proxy/src/index.js`. Add tests: a request with `Origin: https://trailroutine.com` passes in each Worker, and `/https/trailroutine.com/…` gets `403` from the proxy. Verify: `npm test` is green in `workers/cors-proxy`, `workers/tracks` and `workers/elevation`.

## 2. Move module

- [x] 2.1 Add `siteOrigin` and `movedFromHosts` to `web/src/config.ts`, with a test in `web/src/config.test.ts`. Verify: `npm test -- src/config.test.ts` is green.
- [x] 2.2 Add `web/src/move/payload.ts`: build the payload from a `SavedSet` and the settings allowlist, encode it (JSON, gzip, AES-GCM, base64url) and decode it. Verify: unit tests for a round trip with exact coordinates, a wrong key, and damaged text are green.
- [x] 2.3 Add `web/src/move/move-out.ts` for the old origin: a host that does not move, data or no data, a remembered `move` value, and a failed upload. Verify: unit tests with a fake storage, localStorage and `fetch` are green.
- [x] 2.4 Add `web/src/move/move-in.ts` for the new origin: remove `move` from the address, skip an imported key, add the tracks after the saved tracks, copy settings only with a referrer from the old address and only when absent, and return the toast text on a failure. Verify: unit tests with a fake storage, localStorage, `history` and `fetch` are green.
- [x] 2.5 Call both in `web/src/main.tsx` before the render, and add the prop `notice` to `App` that shows a toast after mount. Verify: a browser test renders `App` with `notice` and sees the toast; `npm run build` passes.

## 3. e2e and production check

- [x] 3.1 Add `web/e2e/move.spec.ts`: route both host names to `vite preview`, write tracks and settings on the old origin from a stub page, open the old address, and check the track list and the settings on the new domain. Also check that the fragment survives without data, and that a second visit does not add the tracks again. Verify: `npm run build && npm run e2e -- move` is green.
- [x] 3.2 Make `scripts/prod-check.sh` check the app on both addresses (`SITE` is `https://trailroutine.com`, `OLD_SITE` is `https://nakarte-routing.pages.dev`), and use `https://trailroutine.com` as the `Origin` in `.github/workflows/strava-heatmap-check.yml`, `.github/workflows/tracestrack-check.yml`, `scripts/strava-*-secret.mjs` and `scripts/layer-thumbnails.mjs`. Verify: `prod-check.sh` against `vite preview` prints `ok` for both site lines (`SITE` and `OLD_SITE` set to the local address), and `npm run lint` passes in the root.

## 4. Docs

- [x] 4.1 Update `AGENTS.md` (addresses, the move, how the e2e routes two host names), `README.md` (public address), `docs/architecture/` (the address of the site and the move flow), the Purpose of `openspec/specs/clone-hosting/spec.md`, and the backlog and research plan (step 3: domain and move done, Bulk Redirect open). Verify: `openspec validate --all --strict` passes, and `git grep -n "nakarte-routing.pages.dev" -- README.md` shows only the old address note.

## 5. Integration

- [x] 5.1 Run all checks: `npm test` and `npm run build && npm run e2e` in `web/`, `npm run lint` in the root. Verify: all are green.

## Workflow follow-up

- Archive the change in the same PR.
- After the merge: confirm that `deploy pages` and `smoke` are green, that `prod-check.sh` passes on both addresses, and that a browser profile with data on the old address lands on `https://trailroutine.com` with the data.
- Ask the owner to add `trailroutine.com` to Allowed Domains of the Sentry project, and to the referrer list of the Google Maps key if Street View fails on the new domain.
