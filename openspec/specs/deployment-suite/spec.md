# deployment-suite Specification

## Purpose
Packages the adapter and its 5 dependencies (FastGPT, PostgreSQL+pgvector, Redis, MongoDB, nginx) into a one-command Docker Compose deployment that runs on a single 4C8G cloud server with only port 443 exposed to the public internet.

## Requirements

### Requirement: Six-service compose file
The system MUST ship a `docker-compose.yml` defining exactly six services: `adapter`, `fastgpt`, `pg`, `mongo`, `redis`, `nginx`. Only port 443 on `nginx` MUST be published to the host; all other ports stay on the internal compose network.

#### Scenario: Compose up
- **WHEN** an operator runs `docker compose up -d` on a clean host
- **THEN** all six services become healthy within 2 minutes and `https://<domain>/healthz` returns 200

#### Scenario: Port exposure audit
- **WHEN** an operator runs `docker compose ps`
- **THEN** only `nginx` shows a host port mapping and that port is 443

### Requirement: TLS termination at nginx
The system MUST terminate TLS at the `nginx` container using the certificates in `nginx/certs/fullchain.pem` and `nginx/certs/privkey.pem`, and proxy plain HTTP to the `adapter` service.

#### Scenario: HTTPS request
- **WHEN** a client makes an HTTPS GET to `/healthz`
- **THEN** nginx terminates TLS, forwards the request as HTTP to adapter, and returns the response to the client

#### Scenario: Direct HTTP blocked
- **WHEN** a client makes an HTTP (port 80) request
- **THEN** nginx refuses or redirects to HTTPS (no service is exposed on port 80)

### Requirement: Daily backup script
The system MUST ship `deploy/backup.sh` that runs `pg_dump` for both adapter and FastGPT databases, `mongodump` for FastGPT metadata, and tar-archives the `data/assets/` directory (when present), writing outputs to `backup/` with timestamps and retaining the last 7 days.

#### Scenario: Backup runs successfully
- **WHEN** the backup script runs on a healthy deployment
- **THEN** `backup/` contains `pg_adapter_<date>.sql.gz`, `pg_fastgpt_<date>.sql.gz`, `mongo_<date>.tar.gz`, and (if assets exist) `assets_<date>.tar.gz`

#### Scenario: Backup fails
- **WHEN** any step in the backup script exits non-zero
- **THEN** the script logs the failed step, retains any partial output, and exits non-zero so the cron job can alert

### Requirement: .env template with all required vars
The system MUST ship `.env.template` containing every required env var listed in §7.3 of the deployment manual, with placeholders for secrets and safe defaults for business knobs.

#### Scenario: Operator copies template
- **WHEN** an operator runs `cp .env.template .env && chmod 600 .env`
- **THEN** the file is created with 600 permissions and contains every key the adapter requires at startup

### Requirement: healthz endpoint
The system MUST expose `GET /healthz` returning `{status: 'ok'}` with HTTP 200 when the adapter process is alive AND its direct dependencies (Redis, PostgreSQL) respond to a ping; returning HTTP 503 with `{status: 'degraded', deps:[...]}` when any dependency is unreachable.

#### Scenario: All deps healthy
- **WHEN** Redis and PostgreSQL both respond to ping
- **THEN** `/healthz` returns 200 `{status:'ok'}`

#### Scenario: Redis down
- **WHEN** Redis ping times out
- **THEN** `/healthz` returns 503 `{status:'degraded', deps:['redis']}`

### Requirement: License mode reflected in health
The system MUST downgrade `/healthz` to 503 when the license cache has `valid=false`, so container orchestrators can detect restricted mode.

#### Scenario: License expired
- **WHEN** the cached license state is `valid=false`
- **THEN** `/healthz` returns 503 and includes `license: 'restricted'`

### Requirement: Log persistence and rotation

The deployment suite MUST support logs on stdout (queryable via `docker logs`) and an optional file sink (`LOG_FILE`) rotated by `logrotate` daily/size with a retention window; the deployment manual MUST document `docker logs` and file-log troubleshooting for hosts without SSH.

#### Scenario: Logs queryable without SSH

- **WHEN** the server cannot be reached over SSH
- **THEN** operators can locate issues via `docker logs adapter` or the mounted log file

#### Scenario: Rotation configured

- **WHEN** a log file exceeds the rotation threshold
- **THEN** logrotate rotates it and keeps the configured retention
