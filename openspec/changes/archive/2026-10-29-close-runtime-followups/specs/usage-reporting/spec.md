# Spec Delta

## MODIFIED Requirements

### Requirement: Capacity usage snapshot

Each daily usage report MUST include capacity counters — `docCount`, `qaCount`, and `assetMb` — in addition to message and token counters, and MUST NOT include tenant content or document text. `docCount` MUST come from the tenant's FastGPT data store rather than a best-effort optional endpoint; if it cannot be read, the report MUST NOT be sent with zero and MUST be retried on the next scheduled run.

#### Scenario: Capacity counters reported

- **WHEN** the adapter sends its daily usage report
- **THEN** the payload includes `docCount`, `qaCount`, and `assetMb` alongside the message/token counters

#### Scenario: Control plane stores capacity snapshot

- **WHEN** the control plane receives a daily report
- **THEN** it persists the capacity counters for that tenant and day and exposes them in usage queries

#### Scenario: Document count unavailable

- **WHEN** the FastGPT data store cannot be queried
- **THEN** the report is skipped for this run and retried on the next scheduled run, never sent with `docCount: 0`
