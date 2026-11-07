# Proposal

## Why

The Google Maps «Share» button gives `maps.app.goo.gl/…` links today, and the search understood only `goo.gl/maps/…` (Things to-do «Support maps.app.goo.gl short links in search»). On 2026-11-07 a real link `https://maps.app.goo.gl/9ivZQ71CKMqRPDtQA` resolved through our proxy to `google.com/sorry/` with the target in `continue`, and the target was a place with a name and no coordinates.

## What Changes

- `maps.app.goo.gl` links resolve with one `HEAD` through the proxy, as `goo.gl/maps` links do; `/sorry/` gives its `continue` address, as before.
- A Google place link with a name and no coordinates gives a search by the place name (mapy.cz, then Photon) instead of an error.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `map-search`: «Поиск по ссылкам на карты» gets `maps.app.goo.gl` and the name search for a place without coordinates.

## Impact

`web/src/search/links.ts`, `web/src/search/search.ts` and their unit tests.
