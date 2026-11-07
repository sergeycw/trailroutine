# Proposal

## Why

The project is now `trailroutine`, and the owner registered `trailroutine.com` on 2026-11-07 (`openspec/research/trailroutine.md`, «Plan», step 3). People already have the old address `https://nakarte-routing.pages.dev` and their saved tracks and settings are in the browser storage of that origin. An edge redirect alone would cut them off from that data, because IndexedDB and localStorage are separate for each origin.

## What Changes

- The Pages project `nakarte-routing` serves the site on `https://trailroutine.com` too. The domain is a zone in the same Cloudflare account, with a proxied CNAME to `nakarte-routing.pages.dev`.
- The Workers accept the new origin: `https://trailroutine.com` goes into `ALLOWED_ORIGINS` of the CORS proxy, the track storage and the elevation service. The CORS proxy also treats `trailroutine.com` as an own address and does not proxy it.
- The app on the old address moves the visitor to `https://trailroutine.com` with the same path, query and fragment. When the old address has saved tracks or settings, the app first puts them into the track storage in encrypted form and adds the parameter `move` to the fragment. The key for the encryption is only in the fragment, so the server cannot read the data.
- The app on `trailroutine.com` reads `move`, adds the moved tracks to its saved tracks, copies the settings that it does not have yet, and removes `move` from the address. The same `move` is not imported twice.
- If the old address cannot store the data, it keeps the app as before and tries again on the next visit. If the new address cannot import the data, it shows a toast.
- `scripts/prod-check.sh` checks the app on both addresses. The workflows and scripts that send an `Origin` header use the new domain.
- No Bulk Redirect in this change. It is a later step after a transition period (backlog).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `clone-hosting`: the site on `trailroutine.com`, the move from the old address, and the import of moved data (new requirements).
- `web-client`: the main address of the app is `https://trailroutine.com`, and the old address moves people there.
- `clone-monitoring`: the production check covers both addresses.
- `cors-proxy`: the new origin is allowed, and `trailroutine.com` is an own address.
- `track-storage`: the new origin is allowed.

## Impact

- Code: a new module `web/src/move/`, `web/src/main.tsx`, `web/src/App.tsx` (a toast prop), `web/src/config.ts`; `wrangler.toml` of `workers/cors-proxy`, `workers/tracks` and `workers/elevation`; `workers/cors-proxy/src/index.js`; `scripts/prod-check.sh` and the scripts and workflows with an `Origin` header.
- Tests: unit tests of the move module, Worker tests for the new origin, and an e2e test on two real host names, routed to `vite preview`.
- Cloudflare: the custom domain of the Pages project and the DNS record of the zone `trailroutine.com` (done by the agent through the API and the dashboard).
- Owner: `trailroutine.com` in Allowed Domains of the Sentry project, and in the referrer list of the Google Maps key if the key has one.
- Users: the old address sends them to the new domain with their tracks and settings. Links with `#m=…&nktl=…` keep working.
