# Spec Delta

## MODIFIED Requirements

### Requirement: Six-service compose file

The baseline `docker-compose.yml` MUST define exactly the six single-tenant services `adapter`, `fastgpt`, `pg`, `mongo`, `redis`, `nginx` and MUST NOT define `control-plane`; SaaS deployments MUST layer a separate `docker-compose.saas.yml`. Only port 443 on `nginx` MUST be published to the host by default; all other ports stay on the internal compose network. The control-plane MUST NOT publish a host port unless `CONTROL_PLANE_BIND` is explicitly set to a management address, and its default value MUST NOT be `0.0.0.0`. The baseline compose MUST NOT reference the license issuer tooling or mount the host Docker socket.

#### Scenario: Compose up

- **WHEN** an operator runs `docker compose up -d` on a clean host
- **THEN** only the six baseline services start and `https://<domain>/healthz` returns 200

#### Scenario: Port exposure audit

- **WHEN** an operator runs `docker compose ps` with default settings
- **THEN** only `nginx` shows a host port mapping and that port is 443

#### Scenario: Control plane explicitly bound

- **WHEN** an operator layers `docker-compose.saas.yml` and sets `CONTROL_PLANE_BIND=10.0.0.5`
- **THEN** the control-plane port is bound only to that management address

#### Scenario: Baseline excludes internal tooling

- **WHEN** the baseline compose is rendered without the SaaS overlay
- **THEN** it defines no control-plane service and mounts neither `tools/license-issuer` nor `/var/run/docker.sock`

## ADDED Requirements

### Requirement: Customer delivery package contents

The customer delivery package MUST be assembled from an allowlist — compose files for the baseline stack, nginx configuration, `config/` factory files, `.env` template, image archive or registry reference, and a SHA-256 checksum manifest — and MUST NOT contain source code, `tools/`, signing keys, the SaaS compose overlay, local TLS private keys, `license/license.lic`, `data/`, or `logs/`. Packaging MUST fail when any internal-only artifact would enter the package.

#### Scenario: Allowlisted package produced

- **WHEN** the packaging script runs for a release
- **THEN** the archive contains only the allowlisted artifacts plus `SHA256SUMS.txt`

#### Scenario: Internal artifact rejected

- **WHEN** the packaging input would include `tools/license-issuer`, a signing key, or the SaaS overlay
- **THEN** packaging exits non-zero and names the offending path

#### Scenario: SaaS deployment packaged separately

- **WHEN** the platform team deploys the SaaS control plane
- **THEN** it uses the SaaS compose overlay and issuer key from the delivery-side repository, not the customer package
