#!/usr/bin/env bash
# 私有化 ↔ SaaS 迁移：导出部署数据包（adapter 业务库 + FastGPT 数据 + data/config/license）
#
# 用法：
#   ./scripts/migrate-export.sh [--include-env] [out.tar.gz]
#
# - 默认不打包 .env（含密钥）；如目标环境需沿用同一批密钥，显式加 --include-env。
# - 目标端用 scripts/migrate-import.sh 还原。
# - 迁移前请停写（停止 adapter 或维护窗口），保证 pg_dump 一致性。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INCLUDE_ENV=0
OUT=""
for arg in "$@"; do
  case "$arg" in
    --include-env) INCLUDE_ENV=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) OUT="$arg" ;;
  esac
done
[[ -n "$OUT" ]] || OUT="$ROOT/migration-$(date +%Y%m%d_%H%M%S).tar.gz"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/pkg"

COMPOSE=(docker compose -f deploy/docker-compose.yml)
source .env 2>/dev/null || true
PG_USER="${POSTGRES_USER:-cs}"
PG_DB="${POSTGRES_DB:-csbot}"

echo "[migrate-export] dump adapter pg"
"${COMPOSE[@]}" exec -T pg pg_dump -U "$PG_USER" -d "$PG_DB" > "$TMP/pkg/pg_adapter.sql"
echo "[migrate-export] dump fastgpt pg"
"${COMPOSE[@]}" exec -T pg pg_dump -U "$PG_USER" -d fastgpt > "$TMP/pkg/pg_fastgpt.sql" 2>/dev/null \
  || echo "[migrate-export] WARN: fastgpt pg dump failed (可能版本不同)"
echo "[migrate-export] dump mongo"
"${COMPOSE[@]}" exec -T mongo mongodump --archive --gzip > "$TMP/pkg/mongo.archive.gz" 2>/dev/null \
  || echo "[migrate-export] WARN: mongo dump failed"

for d in data config license; do
  [[ -e "$d" ]] && tar -czf "$TMP/pkg/files_${d}.tar.gz" "$d"
done
[[ "$INCLUDE_ENV" == "1" && -f .env ]] && cp .env "$TMP/pkg/env"

cat > "$TMP/pkg/MANIFEST.txt" <<META
created_at=$(date -Iseconds)
adapter_db=$PG_DB
pg_user=$PG_USER
includes_env=$INCLUDE_ENV
notes=restore with scripts/migrate-import.sh; review .env secrets before shipping
META
tar -czf "$OUT" -C "$TMP/pkg" .
echo "[migrate-export] done: $OUT"
