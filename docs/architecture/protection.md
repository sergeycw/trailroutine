# Protection and limits

One level up: [overview](README.md#overview), block "Cloudflare" and ⑦.

What limits the load and the cost on Cloudflare, and what stops trailroutine from sending requests to the author's infrastructure. Behavior: specs [worker-limits](../../openspec/specs/worker-limits/spec.md) and clone-deploy, requirement ["Bundle without author hosts"](../../openspec/specs/clone-deploy/spec.md#requirement-бандл-без-адресов-автора); the CORS of each service is in its spec. Decisions and numbers: archive [add-worker-limits](../../openspec/changes/archive/2026-10-07-add-worker-limits/design.md). Rules for a new counter: `AGENTS.md`, ["Own backends"](../../AGENTS.md#свои-бэкенды).

## Order of checks in a Worker

```mermaid
flowchart LR
    req["Request"]
    platform["Platform cap per call<br/>[limits] cpu_ms, subrequests"]
    origin{"Origin in ALLOWED_ORIGINS?"}
    rate{"[[ratelimits]] by CF-Connecting-IP,<br/>window 60 s"}
    handler["Handler:<br/>own limits for the body and the request"]
    r403["403, the counter is not used"]
    r429["429 with CORS, Retry-After: 60"]

    req --> platform --> origin
    origin -->|"no"| r403
    origin -->|"yes"| rate
    rate -->|"exceeded"| r429
    rate -->|"ok"| handler
```

The proxy, the tracks and the elevations have the same `ALLOWED_ORIGINS`: the trailroutine site, the app dev server `localhost:8769` and `vite preview` `localhost:4173`. Without `CF-Connecting-IP` (local `wrangler dev`, tests), there is no rate limit. Version URLs (`<version>-<worker>.nakarte-routing.workers.dev`) are off with `preview_urls = false`. For Pages, the deploy keeps only the current deploy (job `prune`, [ci-cd.md](ci-cd.md)): an old version with old limits would bypass the new ones. Pages Functions do not support the rate limiting binding, so their counter is in a separate closed Worker: design [limit-pages-functions](../../openspec/changes/archive/2026-10-08-limit-pages-functions/design.md). Any `curl` can fake `Origin`. Thus CORS protects the users, not the budget: the rate limits and the caps give protection from abuse.

| Entry point | CORS | Rate per 60 s (`namespace_id`) | Cap per call | Request limit | Where |
|---|---|---|---|---|---|
| `nakarte-cors-proxy` | `Origin` or `Referer` from `ALLOWED_ORIGINS`, with `credentials` | layer hosts: 1200 (`1004`), other hosts: 300 (`1007`) | `cpu_ms = 500`, `subrequests = 50` | only `GET`/`HEAD` without a body; trailroutine addresses get `403` | [wrangler.toml](../../workers/cors-proxy/wrangler.toml), [index.js](../../workers/cors-proxy/src/index.js) |
| `nakarte-tracks` | only `Origin` from `ALLOWED_ORIGINS`, with `credentials` | 60 (`1003`), of these 10 writes (`1006`) | `cpu_ms = 500`, `subrequests = 10` | body ≤ 2 MiB, only the link alphabet | [wrangler.toml](../../workers/tracks/wrangler.toml), [index.js](../../workers/tracks/src/index.js) |
| `nakarte-elevation`, `POST /` | only `Origin` from `ALLOWED_ORIGINS`, with `credentials` | 60 (`1002`); R2 read budget: 32 units of 64 reads (`1005`) | `cpu_ms = 10000`, `subrequests = 1100` | ≤ 10 000 points, ≤ 250 000 bytes, ≤ 512 R2 reads (degrees + parts), else `413` | [wrangler.toml](../../workers/elevation/wrangler.toml), [http.rs](../../workers/elevation/core/src/http.rs), [request.rs](../../workers/elevation/core/src/request.rs) |
| Pages Functions `tiles`, `brouter-wasm` | the same origin, no CORS headers | 1200 for both (`1008`), the counter is the Worker `nakarte-guard` through the service binding `GUARD`; without the binding or when it fails, there is no limit | Pages default limits | — | [functions/](../../functions/), [workers/guard](../../workers/guard/) |

Why the proxy limit is higher than the others: design `add-worker-limits`, ["Rate: the Workers Rate Limiting binding"](../../openspec/changes/archive/2026-10-07-add-worker-limits/design.md#частота--привязка-workers-rate-limiting). The cap and the budget of R2 reads for the elevation API: design [limit-elevation-reads](../../openspec/changes/archive/2026-10-08-limit-elevation-reads/design.md). The binding counts calls without weight, so after the cap check, a request uses one call for each 64 reads. Threats with the cost of the worst case, and what is not protected yet: [security audit](../../openspec/research/security-audit.md#итог).

## Bundle check for author hosts

```mermaid
flowchart LR
    build["npm run build from web/<br/>vite build --mode clone → build/"]
    engine{"engine files in build/?<br/>test -f brouter.jar, lookups.dat"}
    scan{"check-no-author-hosts.mjs build:<br/>is there *.nakarte.me?"}
    deploy["wrangler pages deploy"]
    stop(["deploy stopped"])

    build --> engine
    engine -->|"no"| stop
    engine -->|"yes"| e2e["e2e on this build"]
    e2e -->|"failed"| stop
    e2e -->|"passed"| scan
    scan -->|"found"| stop
    scan -->|"clean"| deploy
```

The script ([check-no-author-hosts.mjs](../../scripts/check-no-author-hosts.mjs)) reads the text files of the build except `.map` and fails on any literal `*.nakarte.me`. Before the merge, `check web` does the same check ([ci-cd.md](ci-cd.md)). Why the check is static: design `drop-author-services`, ["Static bundle check"](../../openspec/changes/archive/2026-10-08-drop-author-services/design.md#статическая-проверка-бандла).

One server part asks the author: the track storage Worker reads a `nktl=` key that is not in R2 from `tracks.nakarte.me` and keeps a copy ([track-storage.md](track-storage.md)). The address is in the Worker, not in the bundle, so the check stays strict.

## Checked against

[workers/cors-proxy/wrangler.toml](../../workers/cors-proxy/wrangler.toml), [workers/tracks/wrangler.toml](../../workers/tracks/wrangler.toml), [workers/elevation/wrangler.toml](../../workers/elevation/wrangler.toml), [workers/cors-proxy/src/index.js](../../workers/cors-proxy/src/index.js), [workers/tracks/src/index.js](../../workers/tracks/src/index.js), [workers/elevation/core/src/http.rs](../../workers/elevation/core/src/http.rs), [workers/elevation/worker/src/lib.rs](../../workers/elevation/worker/src/lib.rs), [functions/](../../functions/), [scripts/check-no-author-hosts.mjs](../../scripts/check-no-author-hosts.mjs), [deploy-pages.yml](../../.github/workflows/deploy-pages.yml), [check-web.yml](../../.github/workflows/check-web.yml).
