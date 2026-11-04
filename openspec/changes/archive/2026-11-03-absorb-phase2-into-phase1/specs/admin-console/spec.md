## ADDED Requirements

### Requirement: Role-based console access

The tenant console and `/admin/*` routes MUST distinguish at least `operator` and `admin` roles. Operators MAY manage miss records, assets, import review, and knowledge proxy pages. Admins MAY additionally change license reload, sensitive-word/keyword reload, and role assignments. Unauthenticated requests MUST receive 401.

#### Scenario: Operator denied license reload

- **WHEN** an operator calls `POST /admin/license/reload`
- **THEN** the response is 403

### Requirement: Usage dashboard

The system MUST expose `GET /admin/stats/overview` returning question volume, hit rate, refusal rate, top unanswered questions, and per-chat activity for a selectable period. The tenant console MUST render these metrics on a dashboard page.

#### Scenario: Overview returns aggregate counters

- **WHEN** an authenticated user calls `GET /admin/stats/overview?period=daily`
- **THEN** the response includes numeric fields for messages, hits, refusals, and a top-miss list

### Requirement: Knowledge proxy pages

The data plane MUST proxy FastGPT dataset/document APIs under `/admin/knowledge/*` via `FastGPTClient` only (no direct Mongo/pgvector). The tenant console MUST provide upload and collection status UI that calls these routes.

#### Scenario: Knowledge list uses FastGPTClient

- **WHEN** an admin lists knowledge collections
- **THEN** the adapter calls FastGPT through `FastGPTClient` and returns the proxied result
