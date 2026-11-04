## ADDED Requirements

### Requirement: Archive operations console page

The tenant admin-web MUST provide `/archive` listing archive-linked import jobs and pull state, with an action to trigger a one-shot pull when pull is enabled.

#### Scenario: Archive page loads jobs

- **WHEN** an authenticated operator opens `/archive`
- **THEN** the UI loads archive job/pull-state APIs with Basic Auth

#### Scenario: Trigger pull from UI

- **WHEN** the operator triggers pull on `/archive`
- **THEN** the UI calls the admin pull endpoint and shows async status without blocking the SPA
