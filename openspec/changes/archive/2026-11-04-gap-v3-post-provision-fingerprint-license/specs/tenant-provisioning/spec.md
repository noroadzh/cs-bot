## MODIFIED Requirements

### Requirement: Subscription license issuance

The system MUST call the M9 license issuance to produce a subscription-period license bound to the instance fingerprint, and persist it on the tenant record. For dedicated tenants, when provision used a placeholder or platform-wide fingerprint, after a successful instance health probe the control plane MUST collect the live instance fingerprint via an internal authenticated endpoint, persist `tenant.fingerprint`, re-issue and deploy a license bound to that fingerprint, and trigger reload. Collection/re-issue failure MUST leave the tenant provisioned but MUST set a pending fingerprint flag and expose an operator retry; it MUST NOT weaken signature, fingerprint, anti-replay, or anti-debug checks.

#### Scenario: License bound to instance

- **WHEN** provision succeeds
- **THEN** the tenant holds a license bound to its fingerprint and subscription expiry

#### Scenario: Post-provision fingerprint rebind

- **WHEN** dedicated provision succeeds and the live instance fingerprint differs from the pre-provision placeholder
- **THEN** the tenant fingerprint is updated, a new license is issued and installed, and the instance reloads successfully

#### Scenario: Fingerprint collection pending

- **WHEN** the instance is unreachable for fingerprint collection within timeout
- **THEN** the tenant remains active with fingerprint pending and operator retry is available without silent license bypass
