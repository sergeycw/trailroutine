## ADDED Requirements

### Requirement: No reports after the page leaves

The error tracker SHALL NOT send a report after the page starts to leave: after `beforeunload`, after `pagehide`, and after the start of the move from the old address to the new domain. Errors of aborted loads during a navigation are not errors of the app.

#### Scenario: No reports after the page leaves

- **WHEN** the page starts to leave, and then an aborted load or an engine start fails with an error
- **THEN** the tracker sends no report
