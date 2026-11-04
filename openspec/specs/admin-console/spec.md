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

### Requirement: Quality inspection console page

The tenant admin-web MUST provide a `/quality` page that lists recent inspections and active threshold breaches and MUST allow submitting a manual quality-check sample via the admin API.

#### Scenario: Quality page loads inspections

- **WHEN** an authenticated operator opens `/quality`
- **THEN** the page displays items from `GET /admin/archive/quality-inspections`

#### Scenario: Manual sample from UI

- **WHEN** the operator submits a sample on `/quality`
- **THEN** the UI calls `POST /admin/archive/quality-check` and refreshes the list using the returned `inspectionId` / alerts

### Requirement: Archive operations console page

The tenant admin-web MUST provide `/archive` listing archive-linked import jobs and pull state, with an action to trigger a one-shot pull when pull is enabled.

#### Scenario: Archive page loads jobs

- **WHEN** an authenticated operator opens `/archive`
- **THEN** the UI loads archive job/pull-state APIs with Basic Auth

#### Scenario: Trigger pull from UI

- **WHEN** the operator triggers pull on `/archive`
- **THEN** the UI calls the admin pull endpoint and shows async status without blocking the SPA

### Requirement: Self-serve billing console

The platform (or dedicated self-serve) admin-web surface MUST expose `/register`, `/billing`, and `/billing/orders/:id` calling control-plane self-serve APIs. Mock channel MUST offer an explicit simulate-pay action calling the existing mock pay endpoint. When self-serve is disabled, the UI MUST surface the API `errCode`.

#### Scenario: Register then create order

- **WHEN** a user completes register on `/register`
- **THEN** the UI shows `tenantId` and can navigate to order creation on `/billing`

#### Scenario: Mock pay from UI

- **WHEN** the order channel is mock
- **THEN** simulate-pay succeeds and the UI polls order status until `paid`

