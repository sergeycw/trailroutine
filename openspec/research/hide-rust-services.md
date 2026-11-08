# Hide the Rust services: options

Status: research for the owner's to-do «Research: how to hide the Rust services of trailroutine that have valuable solutions» (2026-11-07). Owner decision 2026-11-08: hide nothing; the services stay in this public repository.

## What is valuable and where it is

- Today the only Rust service is the elevation API in `workers/elevation/`: the crates `core`, `worker`, `server` and `repack`. Its own parts are the object format `NKE1` (one R2 object per degree, quarter-degree chunks of 301×301 `i16` values, zstd over deltas, `workers/elevation/core/src/format.rs`), the isolate cache, and the repack pipeline `scripts/elevation-data.sh`. The grid and the interpolation repeat the Go server of the author (`wladich/elevation_server`), so they are not new.
- `git log` of `workers/elevation/` has only commits of the owner (`sergeycw` and `Sergey Lukashev`). The owner is the only copyright holder of this code, so a license change is possible.
- The repository is public by the owner's decision of 2026-11-07: on GitHub Free, a private repository loses the ruleset `master checks` (`AGENTS.md`, «Апстрим»).

## Facts that limit every option

- Code that is already public stays public. Clones and forks keep it, and the MIT grant of a published version is generally treated as irrevocable: the owner can license new versions differently, but the old versions stay under MIT ([Kyle Mitchell, «Switching Open Software Terms»](https://writing.kemitchell.com/2022/03/07/Switching-Open-Software-Terms); [OSI license-review thread on an «Irrevocable MIT License», 2025](https://lists.opensource.org/pipermail/license-review_lists.opensource.org/2025-July/005844.html)). This is commentary, not a court decision. So hiding works only for future code.
- A deployed Cloudflare Worker does not publish its source: the code is visible only in the repository.
- GitHub Free gives private repositories 2,000 Actions minutes per month; public repositories have no limit for standard runners ([GitHub plans](https://docs.github.com/en/enterprise-server@3.15/get-started/learning-about-github/githubs-plans)). The workflow `check elevation` takes about 1 minute per run (2026-11-07), so a private repository for the Rust services fits the free minutes.

## Options

| Option | What it hides | Cost | Risks |
|---|---|---|---|
| 1. A separate private repository for the Rust services | all future Rust code; the public repository keeps the contract (spec `elevation-api`), the client and tests with stubs | a second repository with its own workflows and secrets (`CLOUDFLARE_API_TOKEN` with Editor on the Worker, R2 keys); a contract change needs two PRs | the old code stays public; the agent and the owner work in two places |
| 2. Option 1 plus a history rewrite of the public repository | the old code in this repository too | `git filter-repo`, a force push, new SHAs for every commit | breaks clones, forks, PR links and archive references; copies elsewhere stay; low value |
| 3. A new license for future versions of the Rust services (for example a source-available license), the code stays public | nothing; it restricts reuse | a `LICENSE` file in `workers/elevation/`, a note in the README | the code stays readable; the license must be enforced to matter |
| 4. Only the core is private: a private crate as a git dependency of the public Worker | the core algorithm | the public CI needs a deploy key as a secret to fetch the crate; PRs from forks cannot build | complex; the public repository cannot build without the secret |
| 5. The whole repository private with GitHub Pro ($4 per month) | everything new, including the app | $4 per month; the public README and screenshot go | the old code stays public in forks and clones |

## Recommendation

Option 1, and only for code that the owner considers valuable. The elevation service is mostly the algorithm of the author's public Go server; its own part is the storage format and the pipeline. A move of the current service hides little, because its code is already public. The best use of option 1 is for new valuable work, for example a future Rust routing engine (backlog, «Варианты движка в браузере»): start it in a private repository from the first commit.

Steps for option 1 when the owner decides:
1. The owner creates a private repository and adds the secrets of the deploy.
2. The agent moves `workers/elevation/` (or starts the new service) there with its workflows `check-elevation.yml` and the Worker job of `deploy-pages.yml`.
3. The public repository keeps the spec `elevation-api`, the client and the e2e stubs; `AGENTS.md` and `docs/architecture/` link to the private repository by name only.
