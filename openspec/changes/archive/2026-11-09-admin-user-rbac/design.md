# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- Tenant `/admin/*` and SaaS `/platform/*` share `AdminGuard` + `RolesGuard` (`apps/adapter/src/admin/`). Login is **env dual-account**: `ADMIN_USER`/`ADMIN_PASSWORD` → role `admin`; optional `ADMIN_OPERATOR_*` → `operator`. Credentials compared via SHA-256 digests of plaintext (not password hashing).
- Control plane (`control-plane-main.ts`) and data plane (`main.ts`) are the **same Nest codebase**, different process/DB: each uses its own `DATABASE_URL`. `PlatformController` already `@UseGuards(..., AdminGuard, ...)`.
- Dangerous platform mutations use **hash-chained** `PlatformAuditService` → `platform_audit_log` (reason required via `PlatformReasonGuard`). That chain is not a request log.
- Data-plane SQL is collected from `miss` / `media` / `license` / `import` only (`ShellProvisioner`); control-plane SQL lives under `platform/`. There is **no** `admin/*.sql` yet. Highest shared NNN in tree today is **023**.
- `deploy/setup.sh` still generates and writes `ADMIN_USER`/`ADMIN_PASSWORD` into `.env` as the live login path.

Constraints: R-5 (ConfigService / zod), management Basic Auth + IP whitelist, no secrets in logs, instance-local tenants (no cross-instance identity federation).

## Goals / Non-Goals

**Goals:**

- Single identity model (user + role tables + argon2id hashes) for both management surfaces, wired through shared `admin/` services and guards.
- Hard cutover: only DB users authenticate; env accounts stop working at runtime.
- Request-level operation audit for every authenticated management call, coexisting with (not replacing) platform hash-chain audit.
- Install/upgrade bootstrap so new installs and existing customers can create the first `admin` without downtime traps beyond documented cutover.
- Extend tenant provisioner migration collection so new tenant data-plane DBs get identity DDL.

**Non-Goals:**

- OAuth / SSO / IdP federation
- Fine-grained permission-point matrix (keep coarse `@Roles('admin'|'operator')`; new roles = seed + annotations later)
- Cross-tenant / cross-DB identity federation or shared user directory between control PG and tenant PG
- Replacing or weakening `platform_audit_log` hash chain / `reason` requirement
- Audit log retention/compaction productization (indexes only; TTL optional later)
- Changing `/internal/*` token auth or `/platform/report` Bearer `CONTROL_PLANE_TOKEN` into DB users

## Decisions

### 1. Module split and ownership

| Piece | Location | Notes |
|---|---|---|
| DDL (data plane / tenant instance) | `apps/adapter/src/admin/024-admin-identity.sql` | New module dir under admin; identity + request audit tables |
| DDL (control plane) | `apps/adapter/src/platform/024-admin-identity.sql` | **Same schema**, duplicated file — keeps “control SQL in `platform/`” rule |
| `AdminIdentityService` / repos | `admin/` | User CRUD, password verify, last-admin guard |
| Password hasher | `admin/password-hasher.ts` (or similar) | Thin wrapper; no business logic in controller |
| `AdminGuard` / `RolesGuard` | `admin/` (shared) | Guard becomes async DB lookup; RolesGuard reads `role_code` from request |
| Request audit interceptor | `admin/` | Applied to `/admin/*` and `/platform/*` controllers |
| Users + audit-log HTTP | `admin/` controllers mounted at `/admin/users`, `/admin/audit-logs`; platform mirrors `/platform/users`, `/platform/audit-logs` (request-level; distinct from `/platform/audit-log` hash chain) |
| Hash-chain audit | `platform/platform-audit.service.ts` | Unchanged contract; actor sourced from `req` admin identity |

**Dependency direction:** `platform` → `admin` (guards/identity) remains allowed; `admin` must **not** import platform services. Request audit stays in `admin/` so data-plane does not depend on platform.

**DB binding (no federation):** identity tables are **instance-local**. Data-plane process reads/writes identity in the tenant/private PG (`DATABASE_URL`). Control-plane process uses the control PG. Same code, different connection string — users never sync across DBs.

**Provisioner:** extend `ShellProvisioner` migration dirs from `['miss','media','license','import']` to include **`admin`**, so newly provisioned tenant instances receive `024-admin-identity.sql`. Update `deploy/docker-compose.yml` mounts + `scripts/check-migrations.sh` coverage accordingly.

**Alternatives considered:**

- Put identity only under `platform/` — rejected: data-plane admin console has no platform module enabled in private installs.
- Shared package for DDL — rejected: overkill; duplicate identical `024` SQL is acceptable and matches existing dual-mount pattern.
- Federation / central IdP — out of scope (non-goal).

### 2. Password hashing

**Choice: argon2id** via the `argon2` npm package (OWASP password storage preference).

- Store PHC-style encoded hash in `admin_user.password_hash` (library default encoding).
- Params: library defaults acceptable for MVP; document memory/time cost if tuned later.
- Verify with constant-time library verify; never log password or hash.
- Bootstrap/setup scripts must hash before INSERT (Node one-liner or small `scripts/` helper calling the same hasher).

**Alternatives considered:**

- Node `crypto.scrypt` — zero new dependency; acceptable fallback if native `argon2` build friction blocks delivery images. Prefer argon2id unless Docker/build proves painful; if switching, keep a `scheme` prefix in the stored string so a later migrate is possible.
- bcrypt — weaker memory-hardness; no benefit over argon2/scrypt here.
- Keep SHA-256 of plaintext (current guard) — rejected; not a password KDF.

### 3. Auth flow (BREAKING cutover)

```
Request → IP whitelist (unchanged)
       → Special cases: /platform/report Bearer CONTROL_PLANE_TOKEN (unchanged; no DB user)
       → Basic Auth decode username/password
       → AdminIdentityService.findByUsername + verify(argon2) + enabled
       → Attach req[ADMIN_ROLE_KEY] = role_code; req.adminUser = { id, username, roleCode }
       → RolesGuard as today
```

- **Remove** env username/password equality path from `AdminGuard`.
- `config.schema`: `ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_OPERATOR_*` become **optional / deprecated** (not required to boot). They are **not** consulted for authentication after cutover. Upgrade bootstrap may read them once as defaults when creating the first DB user.
- Empty `admin_user` table ⇒ all Basic Auth fail with `AUTH_UNAUTHORIZED` (and setup/upgrade docs point to bootstrap).
- `resolveAdminRole` env mapping is retired; role comes from `admin_user.role_code` FK/seed.
- Platform `actor()` helpers must use `req.adminUser.username` (or equivalent) instead of re-parsing Basic Auth.

**Alternatives considered:**

- Soft dual-read (env OR DB) during transition — rejected by proposal: hard cutover + bootstrap script.
- Session/JWT login — rejected: keep Basic Auth for admin-web compatibility.

### 4. Data model (sketch)

Shared across both DBs:

- `admin_role(code PK, name, created_at)` — seed `admin`, `operator`
- `admin_user(id UUID PK, username UNIQUE, password_hash, role_code FK → admin_role, enabled BOOL, created_at, updated_at)`
- `admin_audit_log(id, user_id NULL, username, role_code, method, path, status, cost_ms, client_ip, surface ['admin'|'platform'], created_at)` — **flat**, indexed on `(created_at DESC)`, optional `(username, created_at)`

Rules:

- Cannot disable or demote the last **enabled** `admin` role user.
- Username uniqueness case-sensitive unless we normalize to lower at write — **normalize to lowercase** at create/login for predictable Basic Auth.
- Request audit never stores password, Authorization header, or sensitive bodies; querystring values omitted or redacted (keys-only optional).

### 5. Request audit interceptor vs platform hash-chain

Two parallel mechanisms:

| | Request audit (`admin_audit_log`) | Platform chain (`platform_audit_log`) |
|---|---|---|
| Scope | Every `/admin/*` & `/platform/*` HTTP call (after auth), including GET | Dangerous mutations with business `action` + `reason` |
| Integrity | Best-effort insert; failure → WARN, **do not fail request** | Hash chain + FOR UPDATE; failure → error log, business not rolled back (existing) |
| Actor | Authenticated DB user (or skip/mark for token paths) | Same actor string from identity |
| Query API | `GET /admin/audit-logs`, `GET /platform/audit-logs` (admin role) | Existing `GET /platform/audit-log` (+ verify) |

Exclusions from request audit: health/probes, static console assets, `/platform/report` (machine token). Unauthenticated 401/403 may still record a row with empty `user_id` and username `-` **or** skip — **decision: record only when Guard passed** (avoids password-stuffing log spam with partial creds); IP denials before auth are optional DEBUG/metrics only, not DB rows in MVP.

Platform mutations may produce **both** a request-audit row and a hash-chain row; that is intentional (HTTP evidence vs integrity-critical change log).

### 6. User management API surface

Symmetric:

- Tenant: `GET/POST /admin/users`, `PATCH /admin/users/:id`, `POST /admin/users/:id/disable` — `@Roles('admin')`
- Control: `/platform/users` same shapes — implement via shared service + thin controllers (or one controller with dual path prefix); prefer **two thin controllers** calling `AdminIdentityService` to avoid coupling routing modules.

Audit list: admin-only full list; operator **not** granted full audit in MVP (matches plan default).

### 7. setup.sh bootstrap + upgrade script

**New install (`deploy/setup.sh`):**

1. Stop treating generated `ADMIN_PASSWORD` as the runtime login source of truth.
2. Prompt (or generate + display once) for **first admin username + password** (min length aligned with schema, ≥12 recommended to match deployment-suite hardening).
3. After Postgres is up and migrations applied, run bootstrap helper that INSERTs role seed (if migration didn’t) + first `admin` user with argon2id hash.
4. Optionally still write deprecated `ADMIN_*` into `.env` for one release as unused leftovers — **prefer omit** from required env and document removal to avoid operators thinking env still logs them in.

**Control-plane install:** same bootstrap against control DB (compose/control migrations include `platform/024-admin-identity.sql`).

**Upgrade (`scripts/bootstrap-admin-user.sh`):**

- Idempotent: if ≥1 enabled admin exists, exit 0 with message.
- Else: create first admin from CLI flags or from legacy env `ADMIN_USER`/`ADMIN_PASSWORD` if present.
- Print clear BREAKING notice: env login is dead after upgrade; must run script before relying on console.
- Delivery notes / upgrade README must list this as a mandatory step.

### 8. Migration numbering

| File | NNN | Consumer |
|---|---|---|
| `apps/adapter/src/admin/024-admin-identity.sql` | **024** | Data-plane / tenant PG (compose init + shell-provisioner) |
| `apps/adapter/src/platform/024-admin-identity.sql` | **024** | Control PG (`control-migrations`); may also appear in monorepo initdb if platform SQL is dual-mounted today |

Next free NNN across the tree is **024** (current max 023 in `platform/` and `import/`). Do not reuse 023.

Compose + `check-migrations` + delivery package must list both files. SaaS provisioner copy path must pick up `admin/024-*.sql`.

## Risks / Trade-offs

- **[BREAKING] Existing instances cannot log in after upgrade without bootstrap** → Mandatory `bootstrap-admin-user.sh` + release notes; setup creates first user on greenfield; consider installer preflight that refuses to mark upgrade complete if `admin_user` empty.
- **[Risk] Full request audit write amplification** → Async fire-and-forget insert; single btree on `created_at`; no sync chain lock (unlike platform audit). Retention out of scope.
- **[Risk] Duplicate DDL drift between `admin/024` and `platform/024`** → Keep files identical; tasks/checklist require paired edits; optional comment header “keep in sync”.
- **[Risk] `argon2` native addon in delivery image** → Build in existing Node image; if blocked, fall back to `scrypt` with versioned encoding (Decision 2).
- **[Risk] Guard becomes async DB-bound** → Connection pool from existing PG usage; cache not required for MVP; failed DB → 503/401 with safe errCode, no stack to client.
- **[Trade-off] No soft dual-auth window** → Simpler mental model; higher upgrade discipline.
- **[Trade-off] Operator cannot see global audit** → Least privilege; can revisit without schema change.

## Migration Plan

1. Land SQL `024` + compose/provisioner/check-migrations wiring (tables empty except role seed).
2. Ship identity service + hasher; feature still unreachable until Guard switches.
3. **Cutover commit:** AdminGuard DB-only; config softens `ADMIN_*`; users/audit APIs + interceptor; platform actor uses identity.
4. Update `setup.sh` + add `scripts/bootstrap-admin-user.sh`; admin-web users/audit pages.
5. Deploy order for existing customers: migrate DB → run bootstrap → restart adapter/control-plane → verify login → remove reliance on env passwords.
6. **Rollback:** reverting binary restores env auth **only if** env vars still present; DB tables can remain (harmless). Forward-fix preferred; do not auto-delete users on rollback.

## Open Questions

None that block specs/tasks. Deferred implementation details (exact Nest interceptor vs middleware, admin-web component layout) do not change the architecture above.
