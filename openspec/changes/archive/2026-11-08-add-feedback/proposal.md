# Proposal

## Why

Users have no way to send a question, a bug or an idea to the owner (Things to-do «Create a feedback button», High). The owner's requirements of 2026-11-08: it must be as simple as possible. The user presses a button, writes a message and attaches files, and the owner gets it by email. Email is only the transport and can change later, so the user must not know about it. The owner approved the draft screenshots on 2026-11-08.

## What Changes

- A round button «Send feedback» at the bottom right of the map opens a form with these parts:
  - a required email for the reply (an anonymous form gets spam);
  - a required message;
  - files, up to 10 files and 10 MB in all;
  - «Attach my tracks (N)», on by default.
- The app adds the context to the message: the page address with the view and the layers, a short `nktl=` link to the tracks if attached, the browser and the screen.
- A new Worker `trailroutine-feedback` (`workers/feedback`) gets `POST /feedback`. It checks the form and sends an email to the owner through the `send_email` binding of Email Routing. The sender is `feedback@trailroutine.com`, and Reply-To is the user's email. The recipient is the secret `FEEDBACK_TO`, so it is not in the public repository.
- The limits are the rate (3 messages per 60 s from one IP), the size, and requests only from the site.
- On a phone, the expanded map attribution ends before the button.

## Capabilities

### New Capabilities

- `feedback`: the feedback form of the app and the feedback service.

### Modified Capabilities

None.

## Impact

- New: `workers/feedback/` with its own tests and the workflow `check-feedback.yml`.
- Changed: the job `feedback` in `deploy-pages.yml`, `web/src/feedback/`, `web/src/config.ts` (`feedbackUrl`), `web/src/App.tsx`, `web/src/index.css`, `.github/dependabot.yml`, `AGENTS.md` and `docs/architecture/`.
- Owner steps:
  - Enable Email Routing on `trailroutine.com`.
  - Verify the destination address.
  - Set the secret `FEEDBACK_TO`.
  - Add the new Worker to the deploy token.
