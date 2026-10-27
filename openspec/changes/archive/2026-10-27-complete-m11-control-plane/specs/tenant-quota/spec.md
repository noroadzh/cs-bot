# Spec Delta: tenant-quota

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Quota push to instance

The system MUST push quota changes to the tenant instance immediately (or on the next daily pull) so the instance's local enforcement uses current limits.

#### Scenario: Quota pushed on change

- **WHEN** a quota is updated
- **THEN** the instance receives the new limits without a restart
