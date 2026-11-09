## MODIFIED Requirements

### Requirement: Guided setup

The delivery package MUST ship an executable `deploy/setup.sh` that walks an operator through ordered steps. Each step MUST state what the parameter does and what fails or changes if the value is wrong or edited later. The guide writes operator input into `.env` and MUST NOT start containers before the required values, certificates, and license are present. `deploy/install.sh` MUST remain non-interactive. After deployment, the guide MUST show the Enterprise WeChat console fields that correspond to the saved values, including the callback URL, and the command that applies a later change.

Guided setup MUST additionally collect the **first management admin** username and password, then create that enabled `admin` user in the tenant (and, when installing the control plane, the platform) database after migrations are applied. Setup MUST NOT treat `ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_OPERATOR_*` as the runtime login source. The first-admin password MUST meet the same strength rules as other administrative secrets (minimum length and not a known default). Control-plane installation steps MUST mirror first-admin creation for the control-plane database.

#### Scenario: Step list explains parameters without writing files

- **WHEN** an operator runs `./deploy/setup.sh --steps`
- **THEN** the output lists the ordered steps, states the purpose and later effect of the WeCom and secret parameters, names the callback path `/wecom/callback`, includes the first-admin credential step, and creates no `.env`

#### Scenario: Install stays non-interactive

- **WHEN** an operator runs `./deploy/install.sh` with a completed `.env`
- **THEN** the installer does not prompt and follows the one-click installation behavior

#### Scenario: Setup creates first admin user

- **WHEN** an operator completes guided setup with a strong first-admin username/password on a fresh database
- **THEN** an enabled `admin_user` with role `admin` exists and that credential authenticates `/admin/*` (and the control-plane equivalent when SaaS setup runs)

#### Scenario: Empty user table blocks env-only login after setup messaging

- **WHEN** containers are up but bootstrap/first-admin creation was skipped
- **THEN** management login with legacy env credentials fails and setup/docs instruct the operator to finish first-admin bootstrap

### Requirement: Delivery integrity and secret preflight

The installer MUST verify the delivery package checksum manifest before starting containers and MUST refuse to proceed when any file mismatches. It MUST also refuse to start with known-weak or short administrative secrets, naming each offending key. Strength checks MUST cover database and FastGPT secrets and the **first management admin password** used for DB-user bootstrap (whether collected by setup or supplied to the bootstrap script). Legacy `ADMIN_PASSWORD` MAY remain checked if still present in templates for migration compatibility, but MUST NOT be documented as a valid runtime login credential.

#### Scenario: Checksum mismatch aborts

- **WHEN** `SHA256SUMS.txt` is present and any listed file differs
- **THEN** the installer exits non-zero, names the mismatching files, and starts no container

#### Scenario: Weak secret rejected

- **WHEN** the first-admin password, `POSTGRES_PASSWORD`, or `FASTGPT_ROOT_PASSWORD` is missing, shorter than 12 characters, or a known default
- **THEN** the installer or setup exits non-zero and names the offending key

#### Scenario: Valid package proceeds

- **WHEN** checksums match and all required secrets are strong
- **THEN** the installer proceeds to start the baseline stack

### Requirement: Migration completeness in deployed stacks

Every numbered `src/**/NNN-*.sql` migration MUST be applied to a fresh deployment database, including import-pipeline and control-plane extensions **and** admin-identity DDL (`admin_role`, `admin_user`, `admin_audit_log` on both data-plane and control-plane migration paths). The deployment configuration MUST stay in sync with the migration files, and a repository check MUST fail when a migration is missing from the deployment wiring. Compose/Dockerfile migration mounts MUST include the new admin identity SQL so fresh hosts receive seed roles without manual DDL.

#### Scenario: Fresh deployment has all tables

- **WHEN** a fresh host runs the documented compose deployment
- **THEN** import-pipeline columns/tables, control-plane tables, and admin identity/audit tables exist without manual migration

#### Scenario: Missing migration detected

- **WHEN** a migration file is not mounted/copied by the deployment configuration
- **THEN** the repository check fails and names the missing file

#### Scenario: Seed roles present after migrate

- **WHEN** a fresh deployment finishes migrations
- **THEN** `admin_role` contains `admin` and `operator` on the tenant DB (and on the control-plane DB when SaaS is deployed)

## ADDED Requirements

### Requirement: Upgrade bootstrap for admin users

The delivery MUST provide a one-shot bootstrap path (`scripts/bootstrap-admin-user.sh` and/or a `setup.sh` subcommand) that inserts the first enabled `admin` into an existing deployment database when upgrading from env-based dual accounts. The script MUST hash the password, MUST refuse to run when an enabled admin already exists (unless an explicit force flag is documented), and MUST document that runtime login no longer reads env credentials after bootstrap. A control-plane counterpart MUST exist or the same script MUST accept a surface/target DB selector.

#### Scenario: Bootstrap inserts first admin on upgrade

- **WHEN** an upgraded instance has migrations applied, zero enabled admins, and the operator runs the bootstrap script with a strong username/password
- **THEN** one enabled `admin` user is created and can log in via Basic Auth

#### Scenario: Bootstrap refuses when admin exists

- **WHEN** an enabled admin already exists and the operator runs bootstrap without the documented force flag
- **THEN** the script exits non-zero without changing passwords and names that an admin already exists
