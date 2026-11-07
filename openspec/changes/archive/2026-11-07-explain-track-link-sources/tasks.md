# Tasks

## 1. Code

- [x] 1.1 Add `closedTrackService(url)` to `web/src/tracks/import-url.ts` and check it first in `searchAnyLink` of `web/src/search/search.ts`, with the message about GPX and `Open file`.
- [x] 1.2 Show the hint under the empty bar in focus in `web/src/search/SearchBox.tsx`.

## 2. Tests

- [x] 2.1 Unit tests in `web/src/search/search.test.ts` for each closed service (scenario «Ссылка Strava»), no network.
- [x] 2.2 Browser test in `web/src/search/Search.browser.test.tsx` for the scenario «Подсказка в пустой строке». `check-web.yml` runs both on each PR.

## 3. Docs

- [x] 3.1 Update the item «Импорт по ссылкам» in `openspec/backlog.md`.
