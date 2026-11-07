# Design

## Decisions

### Closed services are a list in the import module

`web/src/tracks/import-url.ts` already lists the sources that the import understands, so the list of closed services lives next to them: `closedTrackService(url)` returns the service name for a link of Strava (`strava.com`, `strava.app.link`), Garmin Connect (`connect.garmin.com`), Wikiloc (`wikiloc.com`), plotaroute (`plotaroute.com`) or MapMagic (`mapmagic.app`), else `null`. The search checks this list before the import services, so such a link never falls to «any file». The check is a host test without the network.

Alternative: a track result that fails on choice with a toast. Rejected: the user then chooses a result that cannot work; an error under the bar answers at once.

### The hint is text under the empty bar

The hint shows when the bar has the focus and no text, in the same glass panel as the results, as 12 px muted text (rule of uniform menus in `AGENTS.md`). It names the kinds of queries and the track link sources: nakarte.me, Yandex ruler, OpenStreetMap traces, Tracedetrail, Sports Tracker, and GPX, KML, KMZ, GeoJSON files by link. The `title` of the bar stays for mouse users.

## Risks / Trade-offs

- The list of sources in the hint repeats the import services; a new service needs a hint update. The test of the hint names the sources, so a change of one without the other is visible in review.
- A closed service can open its tracks later; then its entry goes from the list.
