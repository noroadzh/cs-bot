## ADDED Requirements

### Requirement: Quality inspection console page

The tenant admin-web MUST provide a `/quality` page that lists recent inspections and active threshold breaches and MUST allow submitting a manual quality-check sample via the admin API.

#### Scenario: Quality page loads inspections

- **WHEN** an authenticated operator opens `/quality`
- **THEN** the page displays items from `GET /admin/archive/quality-inspections`

#### Scenario: Manual sample from UI

- **WHEN** the operator submits a sample on `/quality`
- **THEN** the UI calls `POST /admin/archive/quality-check` and refreshes the list using the returned `inspectionId` / alerts
