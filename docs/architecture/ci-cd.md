# CI/CD and data

One level up: [overview](README.md#overview), block ⑦.

All workflows are in [.github/workflows/](../../.github/workflows/). The checks run on a PR and on a push to `master`. The deploy runs on a push to `master` and deploys only the changed services. The data upload runs on a schedule or manually. The deploy behavior is in the spec [clone-deploy](../../openspec/specs/clone-deploy/spec.md), the tile sync behavior is in [tile-sync](../../openspec/specs/tile-sync/spec.md). The manual deploy as a fallback: `AGENTS.md`, ["Public site on Cloudflare"](../../AGENTS.md#публичный-клон-на-cloudflare).

## Checks and deploy

```mermaid
flowchart LR
    pr(["pull_request"])
    push(["push to master"])
    clint["check lint<br/>Biome: workers/, functions/, scripts/"]
    cproxy["check cors proxy"]
    ctracks["check tracks"]
    cweb["check web<br/>biome, tsc, vitest, build,<br/>author hosts in build/, e2e"]
    cguard["check guard"]
    ctiles["check tiles"]
    celev["check elevation"]
    changes["deploy pages: changes<br/>diff with the last successful deploy"]
    djobs["deploy pages: job per Worker<br/>npm test / cargo test, wrangler deploy"]
    dpages["deploy pages: pages<br/>tests of functions and web/, build of<br/>web/ to the root of build/, e2e,<br/>wrangler pages deploy"]

    ghcr["ghcr.io<br/>brouter, pinned digest BROUTER_IMAGE"]
    pages["Pages nakarte-routing<br/>static files + functions/"]
    workers["Workers nakarte-cors-proxy,<br/>nakarte-tracks, nakarte-elevation,<br/>nakarte-guard"]
    prune["deploy pages: prune<br/>delete the Pages deploys, except the current one"]

    pr -->|"paths: workers/**/*.js, functions/**,<br/>scripts/**, biome.json, package*.json"| clint
    pr -->|"paths: workers/cors-proxy/**"| cproxy
    pr -->|"paths: workers/tracks/**"| ctracks
    pr -->|"paths: web/**"| cweb
    pr -->|"paths: workers/guard/**"| cguard
    pr -->|"paths: workers/tiles/**, functions/**,<br/>workers/guard/src/**"| ctiles
    pr -->|"paths: workers/elevation/**"| celev
    push -->|"the same paths"| clint & cproxy & ctracks & cguard & ctiles & celev & cweb
    push --> changes
    changes -->|"workers/<service>/ changed"| djobs
    changes -->|"changes outside docs/, openspec/, .github/,<br/>*.md and the Worker directories with a job"| dpages
    djobs -->|"after the Workers"| dpages
    djobs --> workers
    ghcr -->|"docker create, build.sh:<br/>engine jar and profiles"| dpages
    dpages --> pages
    dpages -->|"after a successful publication"| prune
    prune -->|"Pages API, canonical_deployment"| pages
```

The job `changes` in [deploy-pages.yml](../../.github/workflows/deploy-pages.yml) compares `HEAD` with the commit of the last successful run of `deploy pages`, not with the previous push. Thus the next run deploys the changes of a run that failed or that a new push cancelled (`cancel-in-progress`). A manual run, a change of this workflow, or an unknown base deploys everything. A change of other workflows, `docs/`, `openspec/` and `*.md` does not deploy Pages.

The job of each Worker runs the tests of the service and deploys it. The job `pages` runs after these jobs, and does not run if a Worker deploy fails. After each successful publication, also when the Worker jobs are skipped, the job `prune` deletes all Pages deploys except the current one. It does this only if the current deploy is built from the commit of the run. An old deploy would answer on `<hash>.nakarte-routing.pages.dev` with its own functions and without the new limits. To roll back Pages, revert and push.

The steps of `pages`:

1. Tests of the Pages Functions.
2. Engine files from the image (`build.sh`).
3. The app from `web/`: `npm ci` and Playwright Chromium, `npm test`, `npm run build`. The build is `vite build --mode clone` to the root of `build/`, and the plugin `engineFiles` puts the engine jar and profiles there. Only this step gets the Google key and the Sentry DSN.
4. A check that the engine files are in the build.
5. Sentry Debug IDs in `build/assets` (`sentry-cli sourcemaps inject`, without a token).
6. e2e on this build.
7. Upload of the source maps to Sentry (`sentry-cli sourcemaps upload`). Only this step gets the token, and without the token the step is skipped.
8. Deletion of `build/**/*.map`, with a check.
9. A check of the bundle for author hosts ([protection.md](protection.md)).
10. Publication of Pages.

The deploy does not wait for the `check-<service>` checks: the job of each Worker and the job `pages` run the necessary tests themselves. Before the merge, `check web` does the same bundle check (`../build`).

The BRouter tiles (`workers/tiles`) do not deploy as a separate Worker. Their code is connected as the Pages Function [functions/tiles](../../functions/tiles/[[path]].js) and deploys with Pages. Only the local `wrangler dev` needs [workers/tiles/wrangler.toml](../../workers/tiles/wrangler.toml).

## Data and monitoring

```mermaid
flowchart LR
    cron2(["cron Mon 04:00 UTC"])
    cron3(["cron 05:17 UTC daily"])
    cron5(["cron 05:41 UTC daily"])
    cron6(["cron 05:47 UTC daily"])
    manual(["workflow_dispatch"])

    sync["brouter tiles sync<br/>brouter-tiles-sync.mjs"]
    edata["elevation data<br/>elevation-data.sh"]
    scheck["strava heatmap check"]
    tcheck["tracestrack check"]
    ocheck["openfreemap check"]
    pcheck["prod check<br/>scripts/prod-check.sh"]
    cron4(["cron 05:40 UTC daily,<br/>after the deploy"])
    own["trailroutine services:<br/>Pages, elevations, tracks, proxy"]

    brouterde["brouter.de<br/>segments4, lookups.dat"]
    vfp["viewfinderpanoramas.org"]
    r2tiles[("R2 nakarte-tiles")]
    r2elev[("R2 nakarte-elevation")]
    proxy["Worker nakarte-cors-proxy"]
    ofm["tiles.openfreemap.org"]
    mail(["GitHub email on failure"])

    cron2 --> sync
    manual -->|"only = tiles"| sync
    manual -->|"zips"| edata
    cron3 --> scheck
    manual --> scheck
    brouterde -->|"index, *.rd5"| sync
    sync -->|"S3 API: *.rd5, manifest.json"| r2tiles
    vfp -->|"zip HGT"| edata
    edata -->|"S3 API: dem3/*"| r2elev
    scheck -->|"GET of a heatmap tile,<br/>X-Strava-Cookies = session?"| proxy
    scheck -.-> mail
    cron5 --> tcheck
    manual --> tcheck
    tcheck -->|"GET of a Tracestrack Topo tile,<br/>200: the key works, 503: no key"| proxy
    tcheck -.-> mail
    cron6 --> ocheck
    manual --> ocheck
    ocheck -->|"GET of the TileJSON and one tile:<br/>200 with CORS"| ofm
    ocheck -.-> mail
    cron4 --> pcheck
    manual --> pcheck
    pcheck -->|"read only: / with the app title,<br/>/next/ gives 3xx to /, Range, elevation point,<br/>404 of a track, proxy preflight"| own
    pcheck -.-> mail
```

| Workflow | When | What it does | Target |
|---|---|---|---|
| `check lint` | PR and push with changes in `workers/**/*.js`, `functions/`, `scripts/`, `biome.json`, the root `package.json` and `package-lock.json` | `npm run lint` from the root: Biome with the root `biome.json`, linter only | — |
| `check cors proxy`, `check tracks`, `check guard`, `check tiles` | PR and push with changes in the service directory (`check tiles` also in `functions/` and `workers/guard/src/`) | `vitest` in `workerd` | — |
| `check web` | PR and push with changes in `web/` and `scripts/check-no-author-hosts.mjs` | `biome ci`, `tsc -b`, Vitest (unit in Node and browser mode in Chromium), build to `build/`, check of `build/` for author hosts, Playwright e2e against `vite preview` | — |
| `check elevation` | PR and push with changes in `workers/elevation/` | `cargo fmt`, `clippy` (also for wasm32), `cargo test`, `npm test` in `workerd` | — |
| `deploy pages` | push to `master` (changed services), manually (everything) | tests of the service, build of `web/` and deploy; after Pages, deletion of the old Pages deploys and `prod check` (job `smoke`) | Pages, Workers |
| `brouter tiles sync` | Monday 04:00 UTC, manually | incremental sync of the tiles | R2 `nakarte-tiles` |
| `elevation data` | manually | repack of HGT to `dem3/*` | R2 `nakarte-elevation` |
| `strava heatmap check` | daily 05:17 UTC, manually | a heatmap tile through the proxy; fails without `session` | — |
| `tracestrack check` | daily 05:41 UTC, manually | a Tracestrack Topo tile through the proxy: `503` (no key) is a warning, another failure (key, quota) fails the workflow | — |
| `openfreemap check` | daily 05:47 UTC, manually | the TileJSON of the default basemap OpenFreeMap Outdoor and one tile from its template: `200` with a CORS header, the tile not empty | — |
| `prod check` | daily 05:40 UTC, after the deploy (job `smoke`), manually | `scripts/prod-check.sh`: the app on `/`, the redirect from `/next/` to `/`, the trailroutine services respond; read only | — |

GitHub runs schedules only from the default branch. The workflows that write to Cloudflare and R2 have the condition `github.repository == 'sergeycw/trailroutine'`: a copy in another repository does not run them.

## Secrets

| Secret | Where it is | Who uses it | Permissions |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub | the steps `wrangler` and `prune` in `deploy pages` | Account API token "nakarte deploy": Pages Write, Editor on `nakarte-cors-proxy`, `nakarte-tracks`, `nakarte-elevation`, `nakarte-guard`; no R2 |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub | the steps `wrangler` and `prune` in `deploy pages` | — |
| `GOOGLE_MAPS_API_KEY` | GitHub, optional | the step `web build` in `deploy pages`, variable `VITE_GOOGLE_MAPS_API_KEY`; without the secret, the key is empty and the app uses the keyless mode | key restrictions in Google Cloud (the key is in the bundle) |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | GitHub | `elevation data`, `brouter tiles sync` (R2 S3 API) | Bucket Item Write on `nakarte-elevation` and `nakarte-tiles` |
| `SENTRY_DSN` | GitHub, optional | the step `web build` in `deploy pages`, variable `VITE_SENTRY_DSN`; without the secret, the build has no error tracker | the DSN is public in the bundle; Allowed Domains of the Sentry project limit the senders |
| `SENTRY_AUTH_TOKEN`; variables `SENTRY_ORG`, `SENTRY_PROJECT` | GitHub, optional | the step `upload source maps to sentry` in `deploy pages`; without the token, the step skips the upload | — |
| `STRAVA_SESSION`, `STRAVA_COOKIES` | secrets of the Worker `nakarte-cors-proxy` | the proxy ([cors-proxy.md](cors-proxy.md)) | — |
| `TRACESTRACK_KEY` | secret of the Worker `nakarte-cors-proxy` | the proxy, tiles of the Tracestrack Topo basemap ([cors-proxy.md](cors-proxy.md#tracestrack-key)) | Tracestrack key without a `Referer` list; the free plan gives 100 thousand tiles per month |

Only the steps that use a secret get it (`env` of the step, not of the job): dependency install, tests and build run without secrets. In all workflows, actions are pinned to a full SHA. In the steps with a token, `wrangler` has the exact version from the variable `WRANGLER` (requirement ["Secrets only for the publication steps"](../../openspec/specs/clone-deploy/spec.md#requirement-секреты-только-у-шагов-публикации), [clone-deploy](../../openspec/specs/clone-deploy/spec.md)). The owner adds all secrets; the agent does not enter tokens. Token permissions and the order to add them: `AGENTS.md`, ["Public site on Cloudflare"](../../AGENTS.md#публичный-клон-на-cloudflare) and ["Elevation service"](../../AGENTS.md#сервис-высот-workerselevation). A token leak and narrower permissions: [security audit](../../openspec/research/security-audit.md), [item 5](../../openspec/research/security-audit.md#5-секреты-и-права) and ["Owner steps"](../../openspec/research/security-audit.md#шаги-владельца).

## Checked against

[.github/workflows/](../../.github/workflows/) (all thirteen files), [scripts/brouter-tiles-sync.mjs](../../scripts/brouter-tiles-sync.mjs), [workers/elevation/scripts/](../../workers/elevation/scripts/), [scripts/prod-check.sh](../../scripts/prod-check.sh), [experiments/wasm/cheerpj/build.sh](../../experiments/wasm/cheerpj/build.sh), [web/vite/engine-files.ts](../../web/vite/engine-files.ts), [functions/tiles](../../functions/tiles/[[path]].js), [workers/tiles/wrangler.toml](../../workers/tiles/wrangler.toml).
