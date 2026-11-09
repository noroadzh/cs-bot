# Tasks

## 1. Schema and wiring

- [x] 1.1 Add `apps/adapter/src/admin/024-admin-identity.sql` (roles seed admin/operator, `admin_user`, `admin_audit_log`) and identical `platform/024-admin-identity.sql`; verify files exist and `pnpm -C apps/adapter test -- deploy-migrations.spec.ts` passes after compose/Dockerfile mounts
- [x] 1.2 Mount new SQL in `deploy/docker-compose.yml` + `Dockerfile.adapter`; extend shell-provisioner SQL dirs to include `admin/` if needed; verify deploy-migrations / check-migrations still green

## 2. Identity core

- [x] 2.1 Implement scrypt password helper + `AdminUser` repository (lookup by username, create, update, disable, count enabled admins); verify unit tests for hash verify and last-admin guard helpers
- [x] 2.2 Implement request-audit repository append + list; verify unit test persists one row with username/role/method/path/status without password fields

## 3. Auth cutover

- [x] 3.1 Switch `AdminGuard` to async DB Basic Auth + attach `adminUser`/`adminRole` on request; remove env dual-account login path; keep IP whitelist; verify specs: valid user 200, wrong password 401, disabled 401, env-only credentials 401
- [x] 3.2 Keep `RolesGuard` on `role_code`; verify operator cannot call `@Roles('admin')` endpoints (license/config reload)
- [x] 3.3 Soften `config.schema` so `ADMIN_PASSWORD` / operator env are not required for login; verify adapter still boots with only DB users configured for auth

## 4. APIs

- [x] 4.1 Add `/admin/users` CRUD + disable (admin only) with errCodes `USER_NOT_FOUND` / `LAST_ADMIN_FORBIDDEN` / `AUTH_FORBIDDEN`; verify focused controller/service specs
- [x] 4.2 Mirror `/platform/users*` on control plane using control DB pool; verify platform surface specs or equivalent unit tests
- [x] 4.3 Add Nest interceptor logging every authenticated `/admin/*` and `/platform/*` management call to `admin_audit_log` (fail-open); add `GET /admin/audit-logs` and `GET /platform/audit-logs`; verify each request produces a row and list filters work

## 5. Bootstrap and deploy

- [x] 5.1 Update `deploy/setup.sh` to collect first admin username/password and insert after migrate; verify setup dry-run/docs mention DB user not env login
- [x] 5.2 Add `scripts/bootstrap-admin-user.sh` for upgrades (idempotent); verify script help + refuses empty password; document BREAKING cutover in 部署手册 briefly if required by deployment-suite delta
- [x] 5.3 Ensure package-delivery still allowlists required deploy files; verify `package-delivery.spec.ts` passes

## 6. Admin-web

- [x] 6.1 Login remains Basic against DB users; add Users page (admin) on tenant + platform surfaces; verify vitest covers create/list happy path with mock
- [x] 6.2 Add Audit logs page (admin) on both surfaces; verify list renders mock rows
- [x] 6.3 Hide admin-only menu items for operator role; verify menu gating test or documented assertion

## 7. Integration check

- [x] 7.1 Run `pnpm -C apps/adapter test` focused suites for admin identity/guard/audit/users and `pnpm -C apps/admin-web test`; verify all pass
- [x] 7.2 Update `.cursor/plan/design-gap-matrix.md` and `admin-user-rbac.md` status to reflect completed RBAC (remove from 非目标); verify plan links to this change

## Workflow follow-up

- After apply + verify: `openspec` sync/archive `admin-user-rbac`
- Rebuild delivery package when shipping the cutover
