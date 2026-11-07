# CORS proxy and Strava heatmap

One level up: [overview](README.md#overview), block ④.

The Worker `nakarte-cors-proxy` ([workers/cors-proxy](../../workers/cors-proxy/)) gets a response from a third-party site and returns it to the client with CORS headers. The client adds the source URL to the proxy address (`viaCorsProxy` in [catalog.ts](../../web/src/layers/catalog.ts): `https://host/…` → `<proxy>https/host/…`). These requests go through the proxy:

- track import from links ([sources.ts](../../web/src/tracks/sources.ts), `proxied`);
- mapy.cz search ([mapycz.ts](../../web/src/search/mapycz.ts)) and short link expansion ([links.ts](../../web/src/search/links.ts));
- the layers Tsvetkov (`Mt`), Strava heatmap and the basemap Tracestrack Topo (`Tt`);
- custom layers with the proxy flag.

The shared layer limit (`LAYER_HOSTS`, 1200 per minute) applies only to the layer hosts that the app sends through the proxy. These hosts are Strava heatmap `content-*.strava.com`, Tsvetkov `maptiles.website.yandexcloud.net` and Tracestrack `tile.tracestrack.com`.

Behavior: spec [cors-proxy](../../openspec/specs/cors-proxy/spec.md); limits: [protection.md](protection.md).

## Request handling

```mermaid
flowchart TD
    req["Request /{https|http}/{host}/{path}"]
    origin{"Origin or Referer<br/>in ALLOWED_ORIGINS?"}
    role{"target host in LAYER_HOSTS: Strava heatmap, Tsvetkov,<br/>Tracestrack (or the target did not parse)?"}
    rate{"RATE_LIMITER (1200)<br/>by CF-Connecting-IP"}
    other{"OTHER_RATE_LIMITER (300)<br/>by CF-Connecting-IP"}
    options{"OPTIONS?"}
    method{"GET or HEAD?"}
    target{"targetUrl parsed?"}
    own{"trailroutine address:<br/>*.nakarte-routing.workers.dev,<br/>nakarte-routing.pages.dev, trailroutine.com<br/>and subdomains?"}
    tt{"Tracestrack tile<br/>tile.tracestrack.com/topo_‹language›/z/x/y(@2x).webp?"}
    ttkey{"secret TRACESTRACK_KEY set?"}
    withkey["query string of the client dropped,<br/>?key=TRACESTRACK_KEY"]
    r503["503 Tracestrack key is not set"]
    strava{"heatmap tile<br/>content-*.strava.com/identified/globalheat/?"}
    cookies["heatmapCookie: cookies and their source"]
    send["fetch(target) with GET, no body, redirect manual<br/>headers: accept, accept-language,<br/>content-type, range, user-agent (+ cookie)"]
    resp["Response to the client: no set-cookie,<br/>with CORS, Location rewritten to the proxy,<br/>X-Strava-Cookies for heatmap tiles,<br/>for Tracestrack tiles: headers from an allowlist,<br/>Location without key, own error body,<br/>Cache-Control one day if the response has none,<br/>for HEAD: no body"]
    r403["403 Forbidden"]
    r429["429, Retry-After: 60"]
    r204["204 preflight<br/>GET, HEAD, OPTIONS"]
    r405["405"]
    r404["404"]
    r403own["403 Forbidden target"]

    req --> origin
    origin -->|"no"| r403
    origin -->|"yes"| role
    role -->|"yes"| rate
    role -->|"no"| other
    rate -->|"exceeded"| r429
    other -->|"exceeded"| r429
    rate -->|"ok"| options
    other -->|"ok"| options
    options -->|"yes"| r204
    options -->|"no"| method
    method -->|"no"| r405
    method -->|"yes"| target
    target -->|"no"| r404
    target -->|"yes"| own
    own -->|"yes"| r403own
    own -->|"no"| tt
    tt -->|"yes"| ttkey
    ttkey -->|"no"| r503
    ttkey -->|"yes"| withkey --> send
    tt -->|"no"| strava
    strava -->|"yes"| cookies --> send
    strava -->|"no"| send
    send --> resp
```

The code is `fetch` and `proxy` in [index.js](../../workers/cors-proxy/src/index.js). Why the proxy only reads, blocks the trailroutine addresses and splits the limit by the host role: archive [restrict-cors-proxy](../../openspec/changes/archive/2026-10-08-restrict-cors-proxy/design.md). Why `HEAD` goes out as `GET`, why the proxy forwards `User-Agent`, and why `ALLOWED_ORIGINS` has the app dev server (8769) and `vite preview` (4173): [register: CORS proxy and Strava](decisions.md#cors-proxy-and-strava).

## Tracestrack key

The default basemap of the app is OpenFreeMap Outdoor (`Of`, archive [openfreemap-default-basemap](../../openspec/changes/archive/2026-10-30-openfreemap-default-basemap/design.md)). On an `Of` tile error, the app falls back to the Tracestrack Topo raster (`Tt`), then to OSM. Tracestrack serves its tiles only with an API key. The key is the Worker secret `TRACESTRACK_KEY`, and the client does not know it. The layer address in [catalog.ts](../../web/src/layers/catalog.ts) has no `key`. The proxy adds the key only to the raster tiles `topo_<language>` and `topo__` ([tracestrack.js](../../workers/cors-proxy/src/tracestrack.js)). Thus a request with a fake `Origin` cannot use the quota through the proxy for vector tiles and for API calls at 6 credits each.

The key does not go to the client. The tile headers come from an allowlist, `Location` has no `key`, and the proxy replaces the Tracestrack error body with its own. Without the secret, the proxy answers `503`, and the app falls back to OpenStreetMap with a toast. The app does the same on a Tracestrack `403` or `429` (key rejected, quota, limit). The daily workflow `tracestrack check` checks the key ([ci-cd.md](ci-cd.md)). Decisions and owner steps: design [add-outdoor-basemap](../../openspec/changes/archive/2026-10-09-add-outdoor-basemap/design.md). Behavior: spec cors-proxy, requirement ["Tracestrack key"](../../openspec/specs/cors-proxy/spec.md#requirement-ключ-tracestrack), and spec map-layers, requirement ["Basemap fallback on a tile error"](../../openspec/specs/map-layers/spec.md#requirement-откат-подложки-при-ошибке-тайлов).

## Strava heatmap cookies

CloudFront serves the tiles `content-*.strava.com/identified/globalheat/` only with the signed cookies of a signed-in account. The proxy keeps these cookies itself, and the client does not know about them. The proxy sends the cookie source of a tile in the header `X-Strava-Cookies` ([strava.js](../../workers/cors-proxy/src/strava.js), `heatmapCookie`).

```mermaid
flowchart TD
    start["Heatmap tile"]
    hasSession{"secret STRAVA_SESSION set?"}
    fresh{"cookies from the session fresh<br/>(before the policy expiry − 30 min)?"}
    paused{"failure less than 10 min ago?"}
    refresh["Refresh, one per isolate:<br/>GET www.strava.com/maps/global-heatmap<br/>with the session, redirects only inside www.strava.com"]
    ok{"all 4 cookies received?"}
    best{"old cookies not expired yet?"}
    fallback{"secret STRAVA_COOKIES set?"}
    session(["session"])
    fb(["fallback"])
    none(["none"])

    start --> hasSession
    hasSession -->|"no"| fallback
    hasSession -->|"yes"| fresh
    fresh -->|"yes"| session
    fresh -->|"no"| paused
    paused -->|"yes"| best
    paused -->|"no"| refresh --> ok
    ok -->|"yes"| session
    ok -->|"no, pause 10 min"| best
    best -->|"yes"| session
    best -->|"no"| fallback
    fallback -->|"yes"| fb
    fallback -->|"no"| none
```

What the proxy does with each source:

```mermaid
flowchart LR
    src{"cookie source"}
    anon["GET heatmap-external-{a,b,c}.strava.com/tiles/…<br/>without cookies: z ≤ 12 at px=256, z ≤ 11 at px=512"]
    cf["GET content-*.strava.com/identified/globalheat/…<br/>with cookies, if there are any"]
    rej{"response 401 or 403?"}
    out(["tile to the client,<br/>X-Strava-Cookies = source"])

    src -->|"none, zoom up to the threshold"| anon
    src -->|"session, fallback;<br/>none above the threshold"| cf
    cf --> rej
    rej -->|"no, or zoom above the threshold"| out
    rej -->|"yes, zoom up to the threshold"| anon
    anon -->|"X-Strava-Cookies: anonymous"| out
```

- The owner adds the Worker secrets `STRAVA_SESSION` and `STRAVA_COOKIES` with the scripts [strava-session-secret.mjs](../../scripts/strava-session-secret.mjs) and [strava-heatmap-secret.mjs](../../scripts/strava-heatmap-secret.mjs). The session and the cookies do not go to the log, and go nowhere except `www.strava.com` and the heatmap tiles.
- Once a day, the workflow `strava heatmap check` requests a tile through the proxy. It fails if `X-Strava-Cookies` is not `session` ([ci-cd.md](ci-cd.md)).
- Decisions: archives [add-strava-heatmap-refresh](../../openspec/changes/archive/2026-10-08-add-strava-heatmap-refresh/design.md) and [add-strava-anonymous-fallback](../../openspec/changes/archive/2026-10-08-add-strava-anonymous-fallback/design.md). How to update the secret, and diagnostics: `AGENTS.md`, ["Public site on Cloudflare"](../../AGENTS.md#публичный-клон-на-cloudflare). Session lifetime: [backlog, "Postponed"](../../openspec/backlog.md#отложено).

## Checked against

[workers/cors-proxy/src/index.js](../../workers/cors-proxy/src/index.js), [workers/cors-proxy/src/strava.js](../../workers/cors-proxy/src/strava.js), [workers/cors-proxy/src/tracestrack.js](../../workers/cors-proxy/src/tracestrack.js), [workers/cors-proxy/wrangler.toml](../../workers/cors-proxy/wrangler.toml), [web/src/layers/catalog.ts](../../web/src/layers/catalog.ts) (`viaCorsProxy`), [web/src/layers/custom.ts](../../web/src/layers/custom.ts), [web/src/tracks/sources.ts](../../web/src/tracks/sources.ts), [web/src/search/mapycz.ts](../../web/src/search/mapycz.ts), [web/src/search/links.ts](../../web/src/search/links.ts), [strava-heatmap-check.yml](../../.github/workflows/strava-heatmap-check.yml).
