# Spec Delta

## MODIFIED Requirements

### Requirement: access_token caching and distributed refresh

The system MUST cache the WeCom `access_token` in Redis for 7000 seconds and protect token refresh with a `SETNX` lock to prevent concurrent refreshes when multiple adapter instances run. A cached token with fewer than 300 seconds remaining MUST be treated as expired so refreshes happen ahead of the deadline.

#### Scenario: Fresh token request

- **WHEN** the cached `access_token` is present and has more than 300 seconds remaining
- **THEN** the system uses the cached token without contacting WeCom

#### Scenario: Token near expiry refreshes early

- **WHEN** the cached `access_token` has 300 seconds or fewer remaining
- **THEN** the system refreshes the token before using it, instead of sending a request that would fail

#### Scenario: Token refresh under contention

- **WHEN** two adapter instances both detect an expired token simultaneously
- **THEN** only one refreshes via the `SETNX` lock and the other reuses the refreshed token
