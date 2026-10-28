# Spec Delta

## MODIFIED Requirements

### Requirement: Quota update

The system MUST provide `PATCH /platform/tenants/:id/quota` accepting any subset of `{maxChats, maxMsgsPerDay, maxStorageMb, maxConcurrentQa, maxLlmTokensPerMonth, maxDocs, maxQa, maxAssetMb}` (positive integers) that upserts the quota row and returns it, writing an audit entry with before/after values. A value below 1 or a non-integer MUST return HTTP 400.

#### Scenario: Raise one quota dimension

- **WHEN** an operator sends `{maxChats: 50}` for a tenant whose quota is the default
- **THEN** the response shows `maxChats: 50` with the other dimensions unchanged, and an audit entry records old `5` → new `50`

#### Scenario: Knowledge-base capacity quotas

- **WHEN** an operator sets `{maxDocs: 2000, maxQa: 5000, maxAssetMb: 4096}`
- **THEN** the quota stores all three and subsequent tenant detail exposes them

#### Scenario: Invalid value rejected

- **WHEN** an operator sends `{maxChats: 0}`
- **THEN** the system returns HTTP 400 and the stored quota is unchanged

#### Scenario: Quota for unknown tenant

- **WHEN** an operator sends a quota update for a tenant id that does not exist
- **THEN** the system returns HTTP 404

#### Scenario: LLM token limit set

- **WHEN** an operator sends `{maxLlmTokensPerMonth: 1000000}`
- **THEN** the quota stores the monthly token limit
