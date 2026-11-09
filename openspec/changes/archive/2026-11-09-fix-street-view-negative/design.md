# Design

## Context

See proposal.md, «Why». Measured on production on 2026-11-09 (Playwright, Maps JavaScript API version 65, the class `google-street-view-keyless` on the panel):

- Without a blocker: `canvas.mapsImagerySceneScene__canvas` has the inline style `filter: invert(1)` without `!important`. The scene root `div[aria-label="Street View"]` gets `invert(1)` from `keyless.css`. The panorama is correct.
- With `QuotaService.RecordEvent` blocked: the canvas has no inline filter, the root still gets `invert(1)`. The panorama is negative.
- With `AuthenticationService.Authenticate` or `mapsjs/gen_204` blocked: the canvas is inverted as without a blocker.
- With the locale `ru-RU`, the root keeps `aria-label="Street View"`: Google translates the labels of the buttons, not of the scene root.

## Goals / Non-Goals

**Goals:** a correct panorama with and without a blocker that drops `QuotaService.RecordEvent`.

**Non-Goals:** other effects of blockers on the app; the watermark and the Google window rules stay as they are.

## Decisions

### Invert the root only when the canvas is inverted

The rule gets the condition `:has(canvas[style*="invert"])`. The root follows the actual state of the canvas, not the assumption that Google always inverts it. The CSS selector updates when Google changes the `style` attribute, so a late inversion is also covered. `:has()` works in Chrome 105, Safari 15.4 and Firefox 121.

Alternative: `filter: none !important` on the inverted canvas instead of the second inversion. It is rejected: on production without a blocker, Google then shows a black panorama. Google seems to check the computed filter of its canvas, so the app must keep the canvas filter and cancel it from outside. Probably, this is also why the old client inverts the root and not the canvas.

## Risks / Trade-offs

- [Google moves the inline inversion to another element or changes the attribute text] → the condition does not match, and the panorama without a blocker becomes negative. The browser test checks the rule only on a copy of the markup. Mitigation: the pitfall in `AGENTS.md` already says to look at the DOM of the panel when the negative comes back.
