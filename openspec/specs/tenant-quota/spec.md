# tenant-quota Specification

## Purpose

定义每个租户的资源配额（群数、日消息量、存储、并发问答）与按日用量聚合的记录与校验规则，使平台能够按租户限制用量并为账单导出提供数据基础。

## Requirements

### Requirement: Quota defaults on tenant creation

The system MUST create a `tenant_quota` row for every new tenant holding the platform defaults: `max_chats: 5`, `max_msgs_per_day: 5000`, `max_storage_mb: 2048`, `max_concurrent_qa: 2`.

#### Scenario: New tenant receives default quota

- **WHEN** a tenant is created
- **THEN** its quota row exists with `max_chats: 5`, `max_msgs_per_day: 5000`, `max_storage_mb: 2048`, `max_concurrent_qa: 2`

### Requirement: Quota update

The system MUST provide `PATCH /platform/tenants/:id/quota` accepting any subset of `{maxChats, maxMsgsPerDay, maxStorageMb, maxConcurrentQa, maxLlmTokensPerMonth}` (positive integers) that upserts the quota row and returns it, writing an audit entry with before/after values. A value below 1 or a non-integer MUST return HTTP 400.

#### Scenario: Raise one quota dimension

- **WHEN** an operator sends `{maxChats: 50}` for a tenant whose quota is the default
- **THEN** the response shows `maxChats: 50` with the other dimensions unchanged, and an audit entry records old `5` → new `50`

#### Scenario: Invalid value rejected

- **WHEN** an operator sends `{maxChats: 0}`
- **THEN** the system returns HTTP 400 and the stored quota is unchanged

#### Scenario: Quota for unknown tenant

- **WHEN** an operator sends a quota update for a tenant id that does not exist
- **THEN** the system returns HTTP 404

#### Scenario: LLM token limit set

- **WHEN** an operator sends `{maxLlmTokensPerMonth: 1000000}`
- **THEN** the quota stores the monthly token limit

### Requirement: Daily usage aggregation

The system MUST aggregate per-tenant per-day counters into `tenant_usage_daily` keyed by `(tenant_id, day)`: `msg_count`, `qa_count`, `reject_count`. Aggregation MUST be idempotent per day and MUST NOT reset at midnight by losing prior days' rows.

#### Scenario: Counter increment

- **WHEN** a tenant processes 10 messages and answers 6 of them today
- **THEN** today's usage row holds `msg_count: 10`, `qa_count: 6`, `reject_count: 4`

#### Scenario: Repeated increments accumulate

- **WHEN** three more messages are processed for the same tenant and day
- **THEN** the same row holds `msg_count: 13` and only one row exists for that `(tenant_id, day)`

#### Scenario: New day creates a new row

- **WHEN** the date rolls over and the tenant processes a message
- **THEN** a new row for the new day is created and yesterday's row is unchanged

### Requirement: Usage query with date range

The system MUST provide `GET /platform/tenants/:id/usage?from=&to=` returning daily rows within the inclusive date range (defaulting to the last 30 days), ordered by day ascending, along with a `totals` object summing the counters over the range.

#### Scenario: Default 30-day range

- **WHEN** an operator calls `GET /platform/tenants/<id>/usage` without `from`/`to`
- **THEN** the response holds at most the last 30 days of rows ordered ascending with a `totals` object

#### Scenario: Explicit range

- **WHEN** an operator calls `?from=2026-10-01&to=2026-10-07`
- **THEN** only rows within that inclusive range are returned and `totals` sums exactly those rows

#### Scenario: Range with no data

- **WHEN** an operator queries a range in which the tenant had no activity
- **THEN** the response holds `rows: []` and `totals` with all counters at 0

### Requirement: Quota enforcement on chat admission

The system MUST reject admission of a new authorized chat for a tenant whose current chat count has reached `max_chats`, returning HTTP 409 naming the limit, and MUST NOT register the chat. The check MUST read the tenant's live chat count at admission time rather than a cached value.

#### Scenario: At limit

- **WHEN** a tenant with `max_chats: 5` already authorizes 5 chats and another chat is authorized
- **THEN** the system returns HTTP 409 naming `max_chats` and the chat is not registered

#### Scenario: Below limit

- **WHEN** a tenant with `max_chats: 5` authorizes 2 chats and a 3rd is authorized
- **THEN** the chat is registered normally

#### Scenario: Suspended or terminated tenant denies admission

- **WHEN** any chat admission is attempted for a tenant in `paused` or `terminated` status
- **THEN** the system returns HTTP 403 and registers nothing

### Requirement: Daily message quota enforcement

The system MUST reject message processing for a tenant once its `tenant_usage_daily` row for the current day reaches `max_msgs_per_day`, returning HTTP 429 with a message naming the limit and the day. Enforcement MUST be based on the persisted daily counter so it survives adapter restarts.

#### Scenario: Daily limit reached

- **WHEN** a tenant with `max_msgs_per_day: 100` has processed 100 messages today and one more arrives
- **THEN** the system returns HTTP 429 naming the limit and the current day, and does not process the message

#### Scenario: Limit survives restart

- **WHEN** the adapter restarts after 100 messages were processed today against a 100/day limit
- **THEN** the next message is still rejected with HTTP 429 without any counter reset

#### Scenario: Counter resets next day

- **WHEN** the date rolls over
- **THEN** message processing resumes for the tenant with a fresh daily row

### Requirement: Quota exposure in tenant detail

The system MUST include the tenant's quota row and current-day usage counters in `GET /platform/tenants/:id` so operators can see limits and consumption without a second call.

#### Scenario: Detail shows quota and today usage

- **WHEN** an operator calls `GET /platform/tenants/<id>` for a tenant with 320 messages processed today
- **THEN** the response includes `quota` with all four dimensions and `usageToday.msgCount: 320`

### Requirement: Quota push to instance

The system MUST push quota changes to the tenant instance immediately (or on the next daily pull) so the instance's local enforcement uses current limits.

#### Scenario: Quota pushed on change

- **WHEN** a quota is updated
- **THEN** the instance receives the new limits without a restart
