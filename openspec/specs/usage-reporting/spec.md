# usage-reporting Specification

## Purpose
提供用量统计与计费基础能力，使运营方能够查询每个周期的消息处理量、问答量、素材发送量、token 消耗量，并支持定期上报到外部 webhook。

## Requirements

### Requirement: Usage event counter

The system MUST maintain in-memory counters for the following metrics and expose them via `GET /admin/usage`:
- `messages.received`: total inbound messages received
- `messages.answered`: messages with a successful answer sent
- `messages.refused`: messages rejected due to low confidence
- `messages.missed`: messages recorded as miss (low confidence + miss_recorded)
- `assets.sent`: number of asset items sent
- `qa.tokens.primary`: approximate token count for primary LLM
- `qa.tokens.fallback`: approximate token count for fallback LLM
- `started_at`: ISO timestamp of adapter start or current period start
- `period`: human-readable period string (e.g. "2026-10-13", "2026-W41", "2026-10")

#### Scenario: Counters reflect real activity
- **WHEN** the adapter has processed 10 messages, answered 7, refused 2, missed 1, and sent 3 assets since startup
- **THEN** `GET /admin/usage` returns `messages.received: 10`, `messages.answered: 7`, `messages.refused: 2`, `messages.missed: 1`, `assets.sent: 3`

#### Scenario: Counters survive zero activity
- **WHEN** `GET /admin/usage` is called with no activity
- **THEN** all counters return 0 and `started_at` reflects adapter start time

### Requirement: Period-based aggregation

The system MUST support three period modes: `daily` (current day), `weekly` (ISO week), `monthly` (current month), and the period MUST be selectable via `?period=<mode>` query parameter.

#### Scenario: Daily period
- **WHEN** `GET /admin/usage?period=daily` is called on 2026-10-13
- **THEN** the response includes `period: "2026-10-13"`

#### Scenario: Weekly period
- **WHEN** `GET /admin/usage?period=weekly` is called in ISO week 41 of 2026
- **THEN** the response includes `period: "2026-W41"`

#### Scenario: Monthly period
- **WHEN** `GET /admin/usage?period=monthly` is called in October 2026
- **THEN** the response includes `period: "2026-10"`

#### Scenario: Default period is daily
- **WHEN** `GET /admin/usage` is called without a `period` parameter
- **THEN** the response uses the daily period

### Requirement: Period reset

The system MUST reset in-memory counters when the period rolls over (e.g. midnight for daily). The `started_at` MUST reflect the start of the current period, not the adapter start.

#### Scenario: Daily reset at midnight
- **WHEN** the date changes from 2026-10-13 to 2026-10-14
- **THEN** the next call to `GET /admin/usage?period=daily` returns all counters as 0 and `started_at` is 2026-10-14T00:00:00

### Requirement: Token estimation

The system MUST estimate token counts using the heuristic of `Math.ceil(text.length / 2)` for both primary and fallback LLM calls, incrementing the appropriate counter after each call.

#### Scenario: LLM call increments token counter
- **WHEN** the primary LLM receives a 1200-character question and a 800-character answer
- **THEN** the system increments `qa.tokens.primary` by 1000 (Math.ceil(2000 / 2) = 1000)

#### Scenario: Empty call is not counted
- **WHEN** the LLM call returns immediately with a cache hit
- **THEN** the token counter is not incremented

### Requirement: Usage webhook reporting

The system MUST POST a JSON body `{period, counters, generatedAt}` to `USAGE_WEBHOOK_URL` if configured, at the configured `USAGE_REPORT_INTERVAL` (default 24h), and MUST log the response status without crashing on a non-2xx response.

#### Scenario: Webhook URL configured
- **WHEN** `USAGE_WEBHOOK_URL=https://billing.example.com/usage` is set and `USAGE_REPORT_INTERVAL=86400000` (24h)
- **THEN** the system POSTs the current usage snapshot every 24 hours and logs the HTTP status

#### Scenario: Webhook returns 500
- **WHEN** the configured webhook returns HTTP 500
- **THEN** the system logs the error with the response body but does not crash or stop further reports

#### Scenario: Webhook URL is empty
- **WHEN** `USAGE_WEBHOOK_URL` is empty
- **THEN** the system does not attempt any HTTP call and only logs "usage webhook disabled" at startup

#### Scenario: Webhook timeout
- **WHEN** the webhook does not respond within 10 seconds
- **THEN** the system logs a timeout error, discards the report, and continues normal operation

### Requirement: Usage data durability across restart

The system MUST persist the most recent snapshot of the current period to `data/usage-snapshot.json` on a 60-second timer, and MUST restore the snapshot on startup if it is for the current period.

#### Scenario: Snapshot persistence
- **WHEN** the adapter shuts down with counters `{messages.received: 100, messages.answered: 80}`
- **THEN** `data/usage-snapshot.json` contains `{period: <current>, counters: {...}, generatedAt: <iso>}`

#### Scenario: Snapshot restoration
- **WHEN** the adapter restarts within the same period
- **THEN** the counters are restored from the snapshot, not reset to 0

#### Scenario: Snapshot from previous period is ignored
- **WHEN** the adapter restarts on 2026-10-14 with a snapshot file from 2026-10-13
- **THEN** the snapshot is ignored, counters start at 0, and the snapshot file is overwritten with the new period

### Requirement: Usage summary in license status

The system MUST include a `currentUsage` field in the response of `GET /admin/license` showing `messages.received` and `assets.sent` for the current daily period.

#### Scenario: License status includes usage
- **WHEN** `GET /admin/license` is called and the daily counter shows `messages.received: 50`
- **THEN** the response body includes `currentUsage: {messagesReceived: 50, assetsSent: <int>}`

### Requirement: Capacity usage snapshot

Each daily usage report MUST include capacity counters — `docCount`, `qaCount`, and `assetMb` — in addition to message and token counters, and MUST NOT include tenant content or document text.

#### Scenario: Capacity counters reported

- **WHEN** the adapter sends its daily usage report
- **THEN** the payload includes `docCount`, `qaCount`, and `assetMb` alongside the message/token counters

#### Scenario: Control plane stores capacity snapshot

- **WHEN** the control plane receives a daily report
- **THEN** it persists the capacity counters for that tenant and day and exposes them in usage queries
