## ADDED Requirements

### Requirement: Wildcard ACME DNS-01 operations

The deployment suite MUST document and provide a runnable path (script and/or platform job) for issuing and renewing the SaaS wildcard certificate via ACME DNS-01, including required environment variables for DNS provider credentials. Renewal failure MUST be observable to operators (exit non-zero and/or platform status + ops alert). This path MUST NOT replace the private-deployment single-domain Let's Encrypt setup script as the default for dedicated single-tenant installs.

#### Scenario: Renew job is invocable

- **WHEN** operators run the wildcard renew script or `POST /platform/tls/wildcard/renew` with valid DNS credentials
- **THEN** the shared wildcard material is refreshed or the job fails with a clear error without mutating dedicated-mode per-tenant cert trees

#### Scenario: Private LE path unchanged

- **WHEN** a private dedicated deployment uses the existing single-domain Let's Encrypt steps
- **THEN** those steps remain valid and are not required to use DNS-01 wildcard mode
