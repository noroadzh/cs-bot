# Spec Delta: tenant-registry

## ADDED Requirements

### Requirement: Adapter usage reporting to control plane

Each adapter instance MUST report daily counters (messages in/triggered/hit/miss, tokens, active chats) to the control plane without message bodies. Failed reports MUST be buffered locally for up to 7 days and retried.

#### Scenario: Counters reported

- **WHEN** the daily reporting time is reached
- **THEN** the control plane receives the tenant's counters and no message content

#### Scenario: Control plane unavailable

- **WHEN** the report request fails
- **THEN** the payload is retained for retry for up to 7 days and QA service is unaffected
