# Elevation service

One level up: [overview](README.md#overview), block ⑥.

The Worker `nakarte-elevation` ([workers/elevation](../../workers/elevation/)) answers one request: the elevation API (`POST /`, a list of points → elevations) for the track profile and the export. The data and the arithmetic are the same as the author's (DEM 3″ viewfinderpanoramas). Behavior: spec [elevation-api](../../openspec/specs/elevation-api/spec.md). Decisions: archive [add-elevation-api](../../openspec/changes/archive/2026-10-07-add-elevation-api/design.md). Build, checks and pitfalls: `AGENTS.md`, ["Elevation service"](../../AGENTS.md#сервис-высот-workerselevation).

## Rust workspace crates

```mermaid
flowchart LR
    core["elevation-core<br/>parsing, interpolation,<br/>HTTP responses, dem3 format"]
    worker["elevation-worker<br/>workers-rs, R2, isolate cache"]
    server["elevation-server<br/>axum + files, fallback"]
    repack["elevation-repack<br/>HGT → degree object"]
    zstd["feature encode<br/>native zstd"]

    worker --> core
    server --> core
    repack --> core
    repack --> zstd
    zstd -.-> core
```

- `core` has no I/O. The data source is the trait `Source`, which reads a byte range of an object ([lib.rs](../../workers/elevation/core/src/lib.rs)). Each adapter gives its own source: R2 in `worker`, files in `server`.
- In wasm, the decompression of the parts is pure Rust (`ruzstd`). The compression is the native `zstd` behind the feature `encode`, so only `repack` turns this feature on ([Cargo.toml](../../workers/elevation/repack/Cargo.toml)).
- `worker-build` builds `worker` to `worker/build/index.js` (`[build]` in [wrangler.toml](../../workers/elevation/wrangler.toml)).

## Data in R2 `nakarte-elevation`

```mermaid
flowchart LR
    vfp["viewfinderpanoramas.org<br/>zip with HGT 3″"]
    data["workflow elevation data<br/>elevation-data.sh + elevation-repack"]
    dem3[("dem3/N43E042 …<br/>one object per degree: header NKE1,<br/>16 parts 301×301, zstd of deltas")]

    vfp -->|"curl zip"| data
    data -->|"S3 API, aws s3 cp"| dem3
```

The object format is in [format.rs](../../workers/elevation/core/src/format.rs) and [grid.rs](../../workers/elevation/core/src/grid.rs). The reason for this format: design `add-elevation-api`, ["Format: one object per degree, the author's parts"](../../openspec/changes/archive/2026-10-07-add-elevation-api/design.md#формат-объект-на-градус-куски-автора). Workflow and tokens: [ci-cd.md](ci-cd.md).

## Request to the Worker

```mermaid
flowchart TD
    req["Request"]
    rl{"rate from one IP: API_RATE_LIMITER<br/>(a request with a third-party Origin or without Origin is not counted)"}
    api["POST /<br/>Origin from ALLOWED_ORIGINS, else 403;<br/>not POST: 405, another path: 404;<br/>≤ 10 000 points, ≤ 250 000 bytes,<br/>≤ 512 R2 reads, read budget by IP"]
    pts["part index for each point → read of the dem3 parts<br/>(each part one time) → interpolation"]
    cache[("isolate ByteCache, up to 32 MB:<br/>headers and parts")]
    r2[("R2 nakarte-elevation")]
    apiresp["elevations, one per line, CORS for the origin"]
    r429["429, Retry-After: 60"]

    req --> rl
    rl -->|"exceeded"| r429
    rl -->|"ok"| api --> pts --> apiresp
    pts --> cache
    cache -->|"miss: range read"| r2
```

- Why the cache is in the isolate memory: [register: elevation service](decisions.md#elevation-service).
- Client: the API is in [web/src/elevation/api.ts](../../web/src/elevation/api.ts) (elevation profile, GPX with elevations; attribution `elevationsAttribution` in [config.ts](../../web/src/config.ts)), [client.md](client.md).

## Checked against

[workers/elevation/Cargo.toml](../../workers/elevation/Cargo.toml) and the `Cargo.toml` of the crates, [core/src/http.rs](../../workers/elevation/core/src/http.rs) (`handle`, `counts_toward_limit`), [core/src/request.rs](../../workers/elevation/core/src/request.rs) (`MAX_POINTS`, `MAX_BODY_BYTES`), [worker/src/lib.rs](../../workers/elevation/worker/src/lib.rs), [wrangler.toml](../../workers/elevation/wrangler.toml), [scripts/](../../workers/elevation/scripts/), [elevation-data.yml](../../.github/workflows/elevation-data.yml).
