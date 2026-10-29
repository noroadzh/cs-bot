# Spec Delta

## ADDED Requirements

### Requirement: One-click installation

The delivery package MUST ship an executable `deploy/install.sh` that installs the baseline stack non-interactively and idempotently: it validates prerequisites, prepares host directories and ownership, starts only the six baseline services, waits for `/healthz`, and prints status. A missing prerequisite MUST fail with an actionable message before any container starts. It MUST support `--check` and `--dry-run`.

#### Scenario: Fresh install succeeds

- **WHEN** an operator runs `sudo ./deploy/install.sh` on a host with a filled `.env`, certificates, license, and the adapter image
- **THEN** the six baseline services start, `/healthz` returns 200, and the script prints service status and the access URL

#### Scenario: Missing prerequisite fails fast

- **WHEN** `.env`, a required key, a certificate, the license file, or the adapter image is missing
- **THEN** the script exits non-zero, names the missing item, and starts no container

#### Scenario: Re-run is idempotent

- **WHEN** the script is run again on an already deployed host
- **THEN** directories and permissions are reconciled, running containers stay up, and no duplicate resources are created

#### Scenario: Dry run changes nothing

- **WHEN** the script is run with `--dry-run`
- **THEN** it prints the planned actions and exits without creating directories, loading images, or starting containers

#### Scenario: Baseline only

- **WHEN** the installer starts the stack
- **THEN** it starts the six baseline services and never the control-plane or license issuer tooling
