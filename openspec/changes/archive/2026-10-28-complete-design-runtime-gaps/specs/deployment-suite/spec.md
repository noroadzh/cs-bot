# Spec Delta

## MODIFIED Requirements

### Requirement: Six-service compose file

The baseline `docker-compose.yml` MUST define the six single-tenant services `adapter`, `fastgpt`, `pg`, `mongo`, `redis`, `nginx`, and MAY additionally define a `control-plane` service in SaaS mode. Only port 443 on `nginx` MUST be published to the host by default; all other ports stay on the internal compose network. The control-plane service MUST NOT publish a host port unless `CONTROL_PLANE_BIND` is explicitly set to a management address, and its default value MUST NOT be `0.0.0.0`.

#### Scenario: Compose up

- **WHEN** an operator runs `docker compose up -d` on a clean host
- **THEN** the baseline services become healthy within 2 minutes and `https://<domain>/healthz` returns 200

#### Scenario: Port exposure audit

- **WHEN** an operator runs `docker compose ps` with default settings
- **THEN** only `nginx` shows a host port mapping and that port is 443; the control-plane has no host mapping

#### Scenario: Control plane explicitly bound

- **WHEN** an operator sets `CONTROL_PLANE_BIND=10.0.0.5`
- **THEN** the control-plane port is bound only to that management address

### Requirement: Daily backup script

The system MUST ship `deploy/backup.sh` that runs `pg_dump` for the adapter, FastGPT, and control-plane databases, `mongodump` for FastGPT metadata, and tar-archives the `data/assets/` directory (when present), writing outputs to `backup/` with timestamps and retaining the last 7 days.

#### Scenario: Backup runs successfully

- **WHEN** the backup script runs on a healthy deployment
- **THEN** `backup/` contains adapter, FastGPT, and control-plane database dumps, a Mongo archive, and (if assets exist) an assets archive, all timestamped

#### Scenario: Backup fails

- **WHEN** any step in the backup script exits non-zero
- **THEN** the script logs the failed step, retains any partial output, and exits non-zero so the cron job can alert
