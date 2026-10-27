# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Migration completeness in deployed stacks

Every numbered `src/**/NNN-*.sql` migration MUST be applied to a fresh deployment database, including import-pipeline and control-plane extensions. The deployment configuration MUST stay in sync with the migration files, and a repository check MUST fail when a migration is missing from the deployment wiring.

#### Scenario: Fresh deployment has all tables

- **WHEN** a fresh host runs the documented compose deployment
- **THEN** import-pipeline columns/tables and control-plane tables exist without manual migration

#### Scenario: Missing migration detected

- **WHEN** a migration file is not mounted/copied by the deployment configuration
- **THEN** the repository check fails and names the missing file

### Requirement: Release hardening

Delivered adapter images MUST apply the JavaScript obfuscation step, MUST NOT contain source maps, and MUST publish a SHA-256 checksum manifest for digest verification.

#### Scenario: Hardened image

- **WHEN** a release image is built
- **THEN** the image contains obfuscated JavaScript, no `.map` files, and the delivery package includes `SHA256SUMS`

#### Scenario: Source maps absent

- **WHEN** inspecting a delivered image
- **THEN** no source map or TypeScript source is present
