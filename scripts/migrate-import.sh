#!/usr/bin/env bash
# 私有化 ↔ SaaS 迁移：导入 migrate-export.sh 生成的数据包
#
# 用法（在目标部署根目录）：
#   ./scripts/migrate-import.sh --yes migration-YYYYmmdd_HHMMSS.tar.gz
#
# 前置：目标环境已 `docker compose up -d` 且 pg/mongo 健康；空库或已确认可覆盖。
# 还原顺序：pg adapter → fastgpt pg → mongo → data/config/license →（可选）.env
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ARCHIVE=""
YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) YES=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) ARCHIVE="$arg" ;;
  esac
done
[[ -n "$ARCHIVE" && -f "$ARCHIVE" ]] || { echo "usage: $0 --yes <archive.tar.gz>" >&2; exit 2; }
[[ "$YES" == "1" ]] || { echo "refusing to overwrite without --yes" >&2; exit 2; }

COMPOSE=(docker compose -f deploy/docker-compose.yml)
source .env 2>/dev/null || true
PG_USER="${POSTGRES_USER:-cs}"
PG_DB="${POSTGRES_DB:-csbot}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$ARCHIVE" -C "$TMP"

echo "[migrate-import] restore adapter pg"
"${COMPOSE[@]}" exec -T pg psql -U "$PG_USER" -d "$PG_DB" < "$TMP/pg_adapter.sql"
if [[ -f "$TMP/pg_fastgpt.sql" && -s "$TMP/pg_fastgpt.sql" ]]; then
  echo "[migrate-import] restore fastgpt pg"
  "${COMPOSE[@]}" exec -T pg psql -U "$PG_USER" -d fastgpt < "$TMP/pg_fastgpt.sql"
fi
if [[ -f "$TMP/mongo.archive.gz" && -s "$TMP/mongo.archive.gz" ]]; then
  echo "[migrate-import] restore mongo"
  "${COMPOSE[@]}" exec -T mongo mongorestore --archive --gzip --drop < "$TMP/mongo.archive.gz"
fi
for d in data config license; do
  if [[ -f "$TMP/files_${d}.tar.gz" ]]; then
    echo "[migrate-import] restore $d"
    tar -xzf "$TMP/files_${d}.tar.gz" -C "$ROOT"
  fi
done
if [[ -f "$TMP/env" ]]; then
  echo "[migrate-import] restore .env (请复核密钥/域名/DB 地址)"
  cp "$TMP/env" "$ROOT/.env"
fi
echo "[migrate-import] done. 请重启 adapter: docker compose -f deploy/docker-compose.yml up -d adapter"
