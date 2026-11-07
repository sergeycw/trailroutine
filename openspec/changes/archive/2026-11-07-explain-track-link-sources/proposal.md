# Proposal

## Why

A tester asked on 2026-11-07 «какие вообще ссылки жрёт?» and listed Strava, MapMagic, plotaroute and tracedetrail (backlog, «Отзывы пользователей»). The search bar says only `Search or paste a track link`, and its full hint is a `title`, which a touch device does not show. A link of a service that does not give its tracks (Strava, Garmin Connect, Wikiloc) falls to «any file» and then fails with a network or format error that does not say what to do. The owner decided on 2026-11-07: no Strava import, but a clear message.

Facts checked on 2026-11-07:
- plotaroute.com answers requests that are not from a browser with a bot check (`403`). We do not bypass bot checks, so its links get the same message.
- MapMagic routes are private by default, and GPX export is a PRO feature. There is no public link format to import.
- A tracedetrail link `/en/trace/300530` opens through our proxy with the current parser. The tester's failing link is not known.

## What Changes

- The search recognizes links of Strava, Garmin Connect, Wikiloc, plotaroute and MapMagic without the network. It shows under the bar that the service does not share tracks with other sites, and advises to download a GPX file there and open it with `Open file` in Tracks.
- An empty search bar in focus shows a short hint under itself: what the search understands, with the names of the track link sources.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-search`: the hint of the empty bar («Строка поиска») and the message for links of closed services («Ссылки на треки в поиске»).

## Impact

- `web/src/tracks/import-url.ts`, `web/src/search/search.ts`, `web/src/search/SearchBox.tsx` and their tests.
- `openspec/backlog.md`: the link import feedback is done except the tester's tracedetrail link.
