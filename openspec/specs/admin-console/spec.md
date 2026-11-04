# admin-console Specification

## Purpose
租户运营台与 `/admin/*` 的角色分级、用量看板与 FastGPT 知识库代理页面，使运营可在不直连 FastGPT 存储的前提下完成日常运维。

## Requirements

### Requirement: Role-based console access

The tenant console and `/admin/*` routes MUST distinguish at least `operator` and `admin` roles. Operators MAY manage miss records, assets, import review, and knowledge proxy pages. Admins MAY additionally change license reload, sensitive-word/keyword reload, and role assignments. Unauthenticated requests MUST receive 401.

#### Scenario: Operator denied license reload

- **WHEN** an operator calls `POST /admin/license/reload`
- **THEN** the response is 403

### Requirement: Usage dashboard

The system MUST expose `GET /admin/stats/overview` returning question volume, hit rate, refusal rate, top unanswered questions, and per-chat activity for a selectable period. The tenant console MUST render these metrics on a dashboard page. Acceptance MUST include an end-to-end check that the dashboard page loads counters from this API for at least the daily period.

#### Scenario: Overview returns aggregate counters

- **WHEN** an authenticated user calls `GET /admin/stats/overview?period=daily`
- **THEN** the response includes numeric fields for messages, hits, refusals, and a top-miss list

#### Scenario: Dashboard page binds overview API

- **WHEN** an authenticated operator opens the console dashboard
- **THEN** the page displays overview metrics sourced from `/admin/stats/overview`


### Requirement: Knowledge proxy pages

The data plane MUST proxy FastGPT dataset/document APIs under `/admin/knowledge/*` via `FastGPTClient` only (no direct Mongo/pgvector). The tenant console MUST provide upload and collection status UI that calls these routes, and MUST support one-click miss-to-knowledge ingest that uses the same proxy path. Acceptance MUST include a joint test covering list → one-click ingest → collection status refresh.

#### Scenario: Knowledge list uses FastGPTClient

- **WHEN** an admin lists knowledge collections
- **THEN** the adapter calls FastGPT through `FastGPTClient` and returns the proxied result

#### Scenario: One-click miss ingest via proxy

- **WHEN** an operator triggers one-click ingest for an approved miss or learning suggestion
- **THEN** the adapter writes through `FastGPTClient` and the knowledge UI can refresh collection status afterward

