## Purpose

The feedback of the clone: a form in the app sends a message, files and the context of the page to the feedback service, and the service sends an email to the owner. The user does not see the transport.

## ADDED Requirements

### Requirement: Feedback form

The round button «Send feedback» at the bottom right of the map SHALL open a form with a required email, a required message, files and, if the list has tracks, «Attach my tracks (N)», on by default. Send SHALL post the form with the context of the page and SHALL close the form with a thank-you toast. After an error the form SHALL stay open with its text and SHALL show the reason.

#### Scenario: Send feedback

- **WHEN** the list has one track, and the user writes the email and the message, attaches a file and presses Send
- **THEN** the service gets the email, the message, the file and the context with the page address, an `nktl=` link of the track and the browser; the form closes with the toast «Thanks! We will reply to <email>.»

#### Scenario: Email is required

- **WHEN** the user presses Send with an empty email
- **THEN** nothing is sent, and the form stays open

#### Scenario: Without tracks

- **WHEN** the user turns off «Attach my tracks» and sends the form
- **THEN** the context has no tracks, and the tracks are not stored

#### Scenario: Files over the limit

- **WHEN** the attached files are larger than 10 MB in all
- **THEN** the form shows `Too many files: up to 10 files and 10 MB in all.`, and Send is disabled until the user removes a file

#### Scenario: Service error

- **WHEN** the service answers with an error
- **THEN** the form stays open with the message and shows `Could not send the message. Check the connection and try again.`

### Requirement: Feedback service

The Worker `trailroutine-feedback` SHALL accept `POST /feedback` with `multipart/form-data` only from the origins in `ALLOWED_ORIGINS`. It SHALL send one email to the address in the secret `FEEDBACK_TO`: the sender is `feedback@trailroutine.com`, Reply-To is the email of the form, the subject is `Feedback:` and the start of the message, and the body is the message and the context. The files SHALL go as attachments. The answer SHALL be `204` after a send.

#### Scenario: Message with a file and the context

- **WHEN** the site posts an email, a message, the context and a PNG file
- **THEN** the owner gets one email with Reply-To of the user, the message and the context in the body and the PNG as an attachment; the answer is `204`

#### Scenario: Email is not valid

- **WHEN** the form has no email or an email without `@`
- **THEN** the answer is `400` `Email is not valid`, and no email is sent

#### Scenario: Request from another site

- **WHEN** a request comes with an `Origin` outside `ALLOWED_ORIGINS`
- **THEN** the answer is `403`, and no email is sent

### Requirement: Limits of the feedback service

The service SHALL accept at most 3 messages per 60 s from one IP (`429` with `Retry-After: 60` above it), at most 10 files and 10 MiB of files (`413`, and `400` for too many files), and a message of at most 10 000 characters. A line break in the message or a file name SHALL NOT go into an email header. If the email does not go out, the answer SHALL be `502`, and without `FEEDBACK_TO` it SHALL be `503`. The Worker SHALL have Workers Logs.

#### Scenario: Rate limit

- **WHEN** one IP sends a fourth message within 60 s
- **THEN** the answer is `429` with `Retry-After: 60`, and no email is sent

#### Scenario: Files over the limit

- **WHEN** the files of a message are larger than 10 MiB, or there are 11 files
- **THEN** the answer is `413` or `400`, and no email is sent

#### Scenario: Email delivery fails

- **WHEN** the `send_email` binding throws an error
- **THEN** the answer is `502` `Could not send the message`, and the reason goes to Workers Logs
