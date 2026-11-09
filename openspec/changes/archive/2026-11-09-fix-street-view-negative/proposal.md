# Proposal

## Why

A tester (feedback 2026-11-08, Chrome with the extension uBlock Origin Lite) sees Street View panoramas in negative colors. In an incognito window, where the extensions are off, the panorama is correct.

The cause is in `web/src/streetview/keyless.css`. Without a key, Google inverts the colors of the panorama canvas, and the rule of the app inverts the scene root a second time, always. Google turns on the inversion only after the request `maps.googleapis.com/maps/api/js/QuotaService.RecordEvent`. The list EasyPrivacy blocks this request (rule `/QuotaService.RecordEvent?`), and uBlock Origin Lite uses this list by default. When the request is blocked, Google does not invert the canvas, and the only inversion is the inversion of the app. This was reproduced on production on 2026-11-09: Playwright blocked the request, and the panorama became negative.

## What Changes

- The app inverts the scene root only while the Google canvas has its inline inversion. Without a blocker, the panorama stays as before. With a blocker, the panorama is in normal colors.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `clone-hosting`: requirement «Street View без ключа без режима разработки» — a scenario for a blocker that drops the Google request.

## Impact

`web/src/streetview/keyless.css`, a new browser test `web/src/streetview/keyless.browser.test.ts`. With a Google key, nothing changes: the rules of the mode without a key do not apply.
