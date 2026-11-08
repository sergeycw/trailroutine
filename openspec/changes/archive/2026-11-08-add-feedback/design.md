# Design

## Decisions

- **Email Routing, not Email Sending.** A Worker with a `send_email` binding can send to the verified destination addresses of the account from an address on an Email Routing domain. Such sends are free and do not count toward any quota (developers.cloudflare.com/email-service/platform/limits, «Verified destination addresses», 2026-10-30). The owner is the only recipient, so this is sufficient. The message limit is 25 MiB with the attachments. The binding takes the attachments as `ArrayBuffer`, so the Worker does not build MIME itself.
- **The recipient is a secret.** The binding has no `destination_address`: that attribute would put the owner's address into the public `wrangler.toml`. The Worker reads `FEEDBACK_TO`, and Cloudflare allows only verified addresses anyway. Without the secret the service answers `503`.
- **A separate Worker.** The project rule is one service, one directory in `workers/`, and a separate deploy. The name uses the new product name, `trailroutine-feedback`. The old Workers keep `nakarte-*` until the owner decides on the rename.
- **The form goes to the Worker directly** with CORS from `ALLOWED_ORIGINS`, as the track storage does. `multipart/form-data` needs a preflight, and the Worker answers it.
- **Limits.**
  - Up to 10 files and 10 MiB of files. Base64 adds a third, so the email stays below 25 MiB.
  - The Worker reads at most 10.25 MiB of the body before it parses the form.
  - 3 messages per 60 s from one IP (`[[ratelimits]]`, namespace `1009`). The binding allows only 10 s or 60 s periods.
  - The message has at most 10 000 characters.
  - CR and LF in the subject and the file names become spaces, so they cannot add headers.
- **The context.**
  - The page address carries the view and the layers. The track parameters are already removed after the read.
  - The tracks go as an `nktl=` link of the track storage, the same as «Copy link for all tracks». The owner opens them in the app with the route markup. A failed link writes the reason and does not stop the message.
  - The browser is `navigator.userAgent`, and the screen is the window size and the pixel ratio.
  - The app has no build version, so the email does not have one.
- **The button** is at the bottom right, 12 px from the edge and level with the attribution and the profile button, above the bottom panels (`--bottom-inset`). The owner chose «Подпись уже» for the conflict with the expanded attribution on a phone, so the attribution is 44 px narrower.
- **After a send** the form closes, and a toast shows «Thanks! We will reply to <email>.». The email field keeps its value for the next message. On an error the form stays open with the text and shows the reason.

## Risks / Trade-offs

- The first deploy of a new Worker fails with the CI token (Editor per Worker), and Pages wait for the Workers. So the owner adds the Worker to the token, or deploys it once by hand, before the merge.
- A spammer with many IPs can send messages to the owner, 3 per minute per IP. Turnstile is the next step if this happens (owner decision 2026-11-08: the rate limit for now).
- Emails sent with the binding appear in the Email Routing summary as «dropped» even when they are delivered (the same limits page). The delivery is visible in the inbox and in the Email Sending logs.
