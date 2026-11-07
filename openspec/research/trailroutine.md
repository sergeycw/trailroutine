# trailroutine: rename plan and domain research

Status: steps 1 and 2 are done. Step 3 is done except the Bulk Redirect. Step 4 is open. Facts were checked on 2026-11-07.

## Name

"nakarte" is the brand of the author (nakarte.me), and our product is separate. The owner chose `trailroutine` on 2026-11-07.

- The pun: `routine` is `route` + `-ine` by its parts ([Wiktionary](https://en.wiktionary.org/wiki/routine)). It also means a rehearsed sequence of steps, like the routine of a gymnast. A planned route is such a sequence.
- `trail` covers all outdoor activities, not only hiking.
- Checks on 2026-11-07: whois shows `.com`, `.net`, `.io`, `.org` and `.ru` as not registered. `.app` and `.dev` have no NS records. The GitHub name `trailroutine` and `trailroutine.pages.dev` are free. Trademarks were not checked.
- Risks: in Russian, «рутина» means boredom. [Trail Router](https://apps.apple.com/us/app/-/id1500479574) is a free planner of running routes with GPX export (`trailrouter.com` is taken). The names differ only in the end (-er / -ine).
- Rejected candidates:
  - First round, 2026-10-08. The criteria were: short, the same in Russian and English, about routes and mountains. The candidates were `therourist`, `pokarte`, `nitka`, `kroki` and `tropa`.
  - Second round, 2026-11-07:
    - `triproutine`: `.com` is taken.
    - `hikeroutine`: only about hiking, and close to the app HiiKER.
    - `marshroutine`: "marsh" means a swamp in English.

## Plan

The owner set this order on 2026-11-07.

| Step | What | Who | Status |
|---|---|---|---|
| 1 | Rename the code and the repo (`sergeycw/trailroutine`) | change `rename-to-trailroutine` | done 2026-11-07: [archive](../changes/archive/2026-11-07-rename-to-trailroutine/) |
| 2 | Register `trailroutine.com` at Cloudflare Registrar, in the account of the Pages project (owner decision 2026-11-07; no `.app`) | owner | done 2026-11-07: registered, Cloudflare nameservers |
| 3 | Add the custom domain to the Pages project. The old origin moves the data of users to the new domain automatically, and the Bulk Redirect starts after a transition period (owner decision 2026-11-07) | change `move-to-trailroutine-domain` | domain and move done 2026-11-07: [archive](../changes/archive/2026-11-07-move-to-trailroutine-domain/); the Bulk Redirect is open (backlog) |
| 4 | Create the Pages project `trailroutine` (`trailroutine.pages.dev`) as a staging site for large features | a change | open |

Related work outside the steps:

- `docs/architecture/` is translated to English in a separate PR without an OpenSpec change.
- Specs and archived changes stay in Russian. New artifacts are in English (`openspec/config.yaml`).
- Code comments are translated later as a separate step.

## Registrar

Prices in USD per year, seen on 2026-11-07 on public search pages without a login.

| Registrar | `.com` 1st year | `.com` renewal | `.app` 1st year | `.app` renewal | WHOIS privacy | Source |
|---|---|---|---|---|---|---|
| Cloudflare | 11.17 | 11.17 | 8.20 | 14.20 | free | [search](https://www.cloudflare.com/domains/search?q=trailroutine) |
| Porkbun | 11.81 | 11.81 | 8.75 | 14.93 | free | [search](https://porkbun.com/checkout/search?q=trailroutine.com) |
| Namecheap | 12.08 | 19.98 | 10.98 | 22.98 | free | [.com](https://www.namecheap.com/domains/registration/gtld/com/), [.app](https://www.namecheap.com/domains/registration/gtld/app/) |
| Spaceship | 9.48 + 0.20 | 10.68 + 0.20 | 8.28 + 0.20 | 14.49 + 0.20 | free | [pricing](https://www.spaceship.com/domain-search/pricing/) |

- Cloudflare sells at the registry price plus the ICANN fee, with no markup ([FAQ](https://developers.cloudflare.com/registrar/faq/)). The `.com` registry price went up to 10.97 on 2026-11-01 ([Verisign](https://investor.verisign.com/news-releases/news-release-details/verisign-reports-first-quarter-2026-results)). The Spaceship `.com` renewal is below that price, so expect it to go up.
- Cloudflare Registrar can register new domains, `.app` included ([register](https://developers.cloudflare.com/registrar/get-started/register-domain/), [TLD list](https://www.cloudflare.com/tld-policies/)). A domain on Cloudflare Registrar must use Cloudflare nameservers. A transfer out is blocked for 60 days after registration, by an ICANN rule that every registrar applies ([transfer out](https://developers.cloudflare.com/registrar/account-options/transfer-out-from-cloudflare/)). Verify the registrant email, or Cloudflare parks the domain.
- `.app` works only over HTTPS: the whole TLD is on the HSTS preload list ([registry](https://www.registry.google/domains/app/)). Pages serves HTTPS, so this costs nothing.

Recommendation: register `trailroutine.com` at Cloudflare Registrar in the account of the Pages project. An apex domain on Pages needs a Cloudflare zone anyway (next section), so the nameserver rule of Cloudflare Registrar costs nothing. `.app` is optional.

## Apex domain on Pages

- An apex domain on Pages must be a zone in the Cloudflare account of the Pages project, with Cloudflare nameservers. Cloudflare then creates the CNAME record ([custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)). Only a subdomain can use external DNS, through a CNAME to `<project>.pages.dev`.
- With the domain on Cloudflare Registrar, the zone already exists: add the domain in Workers & Pages → `nakarte-routing` → Custom domains.
- Do not add the CNAME by hand before the dashboard step, or the site answers 522. CAA records must allow the certificate authorities of Cloudflare.

## Redirect from `nakarte-routing.pages.dev`

- Cloudflare documents Bulk Redirects for this ([redirect to custom domain](https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/)). Add one list entry: source `nakarte-routing.pages.dev`, target `https://trailroutine.com`, status 301. Turn on Preserve query string, Subpath matching, Preserve path suffix and Include subdomains. Then add a Bulk Redirect rule for the list. The redirect runs at the edge, before Pages, so no Function runs. The setting is in the dashboard or the API, not in the repo.
- The `#` part of old links survives the redirect. When `Location` has no fragment, the browser keeps the fragment of the request ([RFC 9110 §10.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.2), [Fetch](https://fetch.spec.whatwg.org/#concept-response-location-url)). Do not put `#` in the target. The redirect `/next/` → `/` already depends on this.
- `_redirects` cannot do this: its rules match paths only, and the same file serves the new domain, so a catch-all rule makes a loop ([redirects](https://developers.cloudflare.com/pages/configuration/redirects/)).
- A root `functions/_middleware.js` that checks `Host` works, but it makes every request of the site a billed Function call. `_routes.json` matches paths, not hosts ([routing](https://developers.cloudflare.com/pages/functions/routing/)). The repo avoids a root middleware for this reason (`functions/tiles/_middleware.js`).
- Browsers cache a 301 with no end date. Test with 302 first, then change to 301.

## Data of users stays on the old origin

The owner chose on 2026-11-07: move the data automatically, then start the redirect. The alternatives were a "we moved" notice on the old origin (users move the data by hand) and a redirect at once (users lose the data).

- IndexedDB and localStorage are separate for each origin ([MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)). The autosaved tracks (IndexedDB `nakarte-web`) and the settings (`nakarte-web:*`) of current users stay on `nakarte-routing.pages.dev`.
- After the edge redirect, no code runs on the old origin, so the app on the new domain never sees this data. Tracks that users shared by link (`nktl=`) are on the server and keep working.
- To keep the data, the old origin must hand it to the new origin before the redirect starts. For example, a page on the old origin reads the data and sends it to a top-level window of the new domain. A hidden iframe of the old origin inside the new site probably does not work, because browsers partition the storage of third-party iframes. Check this in the change of step 3.

## Places with the old origin

Step 3 adds the new domain, and step 4 adds the staging host, to:

- `ALLOWED_ORIGINS` in `workers/cors-proxy/wrangler.toml`, `workers/tracks/wrangler.toml` and `workers/elevation/wrangler.toml`;
- the list of own hosts of the CORS proxy (`workers/cors-proxy/test/cors-proxy.test.js`);
- `SITE` in `scripts/prod-check.sh` (after the redirect, the old address answers 301);
- `ORIGIN` in `scripts/strava-*-secret.mjs` and `scripts/layer-thumbnails.mjs`;
- the `Origin` header in `.github/workflows/strava-heatmap-check.yml` and `tracestrack-check.yml`;
- outside the repo: Allowed Domains of the Sentry project, and the referrer list of the Google Maps key if it has one.

## Staging project

- `trailroutine.pages.dev` has no DNS record now. Names on `pages.dev` are global: if the name is taken, Cloudflare adds random characters ([direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)). Only creating the project confirms the name.
- An account can have 100 Pages projects ([limits](https://developers.cloudflare.com/pages/platform/limits/)).
- With Include subdomains on in step 3, branch aliases of `nakarte-routing` (`<branch>.nakarte-routing.pages.dev`) also redirect. This is one more reason for a separate staging project.
