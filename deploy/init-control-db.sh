#!/usr/bin/env bash
# 初始化控制面独立数据库（仅首次初始化数据卷时执行）
set -euo pipefail
DB="${CONTROL_PLANE_DB:-csbot_control}"
if ! psql -U "$POSTGRES_USER" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1; then
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $DB"
fi
for f in /control-migrations/*.sql; do
  [[ -f "$f" ]] || continue
  echo "[init-control-db] apply $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$DB" -f "$f"
done
