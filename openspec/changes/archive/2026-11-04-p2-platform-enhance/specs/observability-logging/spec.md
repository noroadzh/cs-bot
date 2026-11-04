## ADDED Requirements

### Requirement: Prometheus metrics export

The adapter (and control plane when enabled) MUST expose a Prometheus text exposition endpoint (e.g. `GET /metrics`) that includes process liveness and key pipeline counters (at least inbound messages, QA success/fail or equivalent, and license-restricted responses when applicable). The endpoint MUST NOT flood access logs the way frequent `/healthz` polls must not. Access MUST be restrictable (IP allowlist and/or separate bind / internal-only). Metrics export MUST be configurable and MAY default off.

#### Scenario: Scrape returns prometheus text

- **WHEN** metrics export is enabled and a scraper calls `GET /metrics`
- **THEN** the response is Prometheus text format with at least one process or pipeline metric series

#### Scenario: Metrics disabled by default or guarded

- **WHEN** metrics export is disabled
- **THEN** `/metrics` is not publicly useful (404/disabled) or is unreachable outside the allowlist
