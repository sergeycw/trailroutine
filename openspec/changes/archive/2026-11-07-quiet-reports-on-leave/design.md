# Design

## Decisions

- **A gate in beforeSend.** `tracking.ts` keeps a flag `leaving`; `beforeSend` returns `null` when it is set, else the scrubbed event as before. The flag is set by `beforeunload` and `pagehide` (Safari on iOS does not always send `beforeunload`), and by `main.tsx` right before `location.replace` of the move.
- **Drop everything, not a list of messages.** The aborted loads give different messages in each browser and for each module; after the leave starts, no report helps, so a filter by message would only miss new variants.

## Risks / Trade-offs

- A real error in the last moment of a page is lost. It would come again on the next visit.
