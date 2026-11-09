#!/usr/bin/env bash
# 升级/首次：在目标 PG 中创建首个 enabled admin（幂等）
#
#   DATABASE_URL=postgresql://... ./scripts/bootstrap-admin-user.sh --user admin --password '...'
#   ./scripts/bootstrap-admin-user.sh --help
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_NAME=""
PASSWORD=""
DATABASE_URL="${DATABASE_URL:-}"

usage() {
  cat <<'EOF'
Usage: bootstrap-admin-user.sh --user <name> --password <pass> [--database-url URL]

Creates the first enabled admin user if none exists (idempotent).
Password is hashed with scripts/hash-admin-password.mjs (scrypt).
Env ADMIN_USER / ADMIN_PASSWORD may supply defaults when flags omitted.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --database-url) DATABASE_URL="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 1 ;;
  esac
done

USER_NAME="${USER_NAME:-${ADMIN_USER:-admin}}"
PASSWORD="${PASSWORD:-${ADMIN_PASSWORD:-}}"
DATABASE_URL="${DATABASE_URL:-${DATABASE_URL:-}}"

if [[ -z "$PASSWORD" ]]; then
  echo "[bootstrap-admin-user] ERROR: empty password" >&2
  exit 1
fi
if [[ ${#PASSWORD} -lt 8 ]]; then
  echo "[bootstrap-admin-user] ERROR: password must be >= 8 chars" >&2
  exit 1
fi
if [[ -z "$DATABASE_URL" ]]; then
  if [[ -f "$ROOT/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$ROOT/.env"; set +a
    DATABASE_URL="${DATABASE_URL:-}"
  fi
fi
[[ -n "$DATABASE_URL" ]] || { echo "[bootstrap-admin-user] ERROR: DATABASE_URL required" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "[bootstrap-admin-user] ERROR: psql not found" >&2; exit 1; }

USER_NAME="$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]')"
count="$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM admin_user WHERE role_code='admin' AND enabled=TRUE" 2>/dev/null || echo 0)"
if [[ "${count:-0}" -ge 1 ]]; then
  echo "[bootstrap-admin-user] enabled admin already exists; skip"
  exit 0
fi

HASH="$(node "$ROOT/scripts/hash-admin-password.mjs" "$PASSWORD" | tr -d '\n')"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO admin_role (code, name) VALUES ('admin', 'Administrator'), ('operator', 'Operator')
ON CONFLICT (code) DO NOTHING;
INSERT INTO admin_user (id, username, password_hash, role_code, enabled)
VALUES (gen_random_uuid(), '$USER_NAME', '$HASH', 'admin', TRUE);
SQL
echo "[bootstrap-admin-user] created admin user=$USER_NAME"
echo "[bootstrap-admin-user] BREAKING: env ADMIN_* no longer authenticates; use this DB user"
