# Spec Delta

## ADDED Requirements

### Requirement: Capacity usage snapshot

Each daily usage report MUST include capacity counters — `docCount`, `qaCount`, and `assetMb` — in addition to message and token counters, and MUST NOT include tenant content or document text.

#### Scenario: Capacity counters reported

- **WHEN** the adapter sends its daily usage report
- **THEN** the payload includes `docCount`, `qaCount`, and `assetMb` alongside the message/token counters

#### Scenario: Control plane stores capacity snapshot

- **WHEN** the control plane receives a daily report
- **THEN** it persists the capacity counters for that tenant and day and exposes them in usage queries
