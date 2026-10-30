# deployment-suite Specification

## Purpose
Packages the adapter and its 5 dependencies (FastGPT, PostgreSQL+pgvector, Redis, MongoDB, nginx) into a one-command Docker Compose deployment that runs on a single 4C8G cloud server with only port 443 exposed to the public internet.

## Requirements

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

### Requirement: TLS termination at nginx
The system MUST terminate TLS at the `nginx` container using the certificates in `nginx/certs/fullchain.pem` and `nginx/certs/privkey.pem`, and proxy plain HTTP to the `adapter` service.

#### Scenario: HTTPS request
- **WHEN** a client makes an HTTPS GET to `/healthz`
- **THEN** nginx terminates TLS, forwards the request as HTTP to adapter, and returns the response to the client

#### Scenario: Direct HTTP blocked
- **WHEN** a client makes an HTTP (port 80) request
- **THEN** nginx refuses or redirects to HTTPS (no service is exposed on port 80)

### Requirement: Daily backup script

The system MUST ship `deploy/backup.sh` that runs `pg_dump` for the adapter, FastGPT, and control-plane databases, `mongodump` for FastGPT metadata, and tar-archives the `data/assets/` directory (when present), writing outputs to `backup/` with timestamps and retaining the last 7 days.

#### Scenario: Backup runs successfully

- **WHEN** the backup script runs on a healthy deployment
- **THEN** `backup/` contains adapter, FastGPT, and control-plane database dumps, a Mongo archive, and (if assets exist) an assets archive, all timestamped

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

### Requirement: Local model deployment

The deployment suite MUST provide `local-models-compose.yml` (vllm + xinference), model pull and health-check scripts, and MUST document that switching embedding requires rebuilding the vector index.

#### Scenario: Local models compose starts healthy

- **WHEN** the local-model profile is deployed
- **THEN** vllm and xinference start and pass their health checks

#### Scenario: Embedding switch requires reindex

- **WHEN** embedding is switched between cloud and local
- **THEN** the runbook requires a full vector index rebuild before serving

### Requirement: Acceptance orchestration (mock-first)

The deployment suite MUST provide mock-first acceptance orchestration (local Postgres + Redis mock + FastGPT mock + WeCom signature mock) with an ab load test, and MUST retain an optional real six-service compose smoke for network/CI environments.

#### Scenario: Mock acceptance runs

- **WHEN** acceptance is run
- **THEN** the mock full stack executes the cases and load test and emits a report

#### Scenario: Real stack optional

- **WHEN** the environment has network and explicitly enables it
- **THEN** the real six-service smoke can run; otherwise it is skipped

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

### Requirement: Per-tenant backup

The daily backup MUST include every provisioned tenant instance: PostgreSQL dump, MongoDB dump, and tenant data directory, retaining the configured window per tenant.

#### Scenario: Tenant backup produced

- **WHEN** the daily backup runs with active tenants
- **THEN** each tenant has pg/mongo/data artifacts in its backup directory

#### Scenario: Failed tenant isolated

- **WHEN** one tenant backup fails
- **THEN** the failure is logged and other tenants still complete

### Requirement: Non-root container runtime

The delivered adapter and control-plane images MUST run as a non-root UID/GID by default (default 65532), and the compose files MUST NOT default to UID 0. Mounted data, logs, and license directories MUST be writable by that user, and an operator MUST be able to override the UID/GID through `CSBOT_UID`/`CSBOT_GID` for host-directory ownership constraints.

#### Scenario: Default containers are non-root

- **WHEN** an operator runs the compose stack without setting `CSBOT_UID`
- **THEN** the adapter and control-plane processes report a non-zero UID

#### Scenario: Writable mounts

- **WHEN** the non-root adapter writes a log line, an imported file, and a license file under its mounted directories
- **THEN** all three writes succeed

#### Scenario: Explicit UID override

- **WHEN** an operator sets `CSBOT_UID=1500` and `CSBOT_GID=1500`
- **THEN** both containers run with those IDs and the operator can align host directory ownership

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

### Requirement: Per-service memory limits

The baseline compose MUST declare an explicit memory limit for every service, and Redis MUST run with `maxmemory` and an eviction policy so that one component's growth cannot exhaust the host and kill the others.

#### Scenario: Every service is bounded

- **WHEN** the baseline compose is rendered
- **THEN** each of the six services declares a `mem_limit`, and the sum stays within the documented 4C8G budget

#### Scenario: Redis evicts instead of growing

- **WHEN** Redis reaches its configured `maxmemory`
- **THEN** it evicts keys under the configured policy instead of consuming host memory

### Requirement: FastGPT admin console access

The baseline deployment MUST expose the FastGPT admin console through nginx on a dedicated port that is denied by default and reachable only from operator-configured CIDRs.

#### Scenario: Default denies every client

- **WHEN** the baseline stack runs without any allow-list configured
- **THEN** requests to the admin port are rejected for all client addresses

#### Scenario: Configured CIDR can reach the console

- **WHEN** an operator configures one or more CIDRs and re-runs the installer
- **THEN** clients inside those CIDRs reach the FastGPT admin console and others are still denied

#### Scenario: Console is not on the public entry port

- **WHEN** the stack is inspected for published ports
- **THEN** the admin console is served on its own port, separate from the callback port 443

### Requirement: Delivery integrity and secret preflight

The installer MUST verify the delivery package checksum manifest before starting containers and MUST refuse to proceed when any file mismatches. It MUST also refuse to start with known-weak or short administrative secrets, naming each offending key.

#### Scenario: Checksum mismatch aborts

- **WHEN** `SHA256SUMS.txt` is present and any listed file differs
- **THEN** the installer exits non-zero, names the mismatching files, and starts no container

#### Scenario: Weak secret rejected

- **WHEN** `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` or `FASTGPT_ROOT_PASSWORD` is missing, shorter than 12 characters, or a known default
- **THEN** the installer exits non-zero and names the offending key

#### Scenario: Valid package proceeds

- **WHEN** checksums match and all required secrets are strong
- **THEN** the installer proceeds to start the baseline stack
