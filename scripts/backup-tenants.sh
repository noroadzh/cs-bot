#!/usr/bin/env bash
# 按租户实例备份：pg / mongo / data+license，失败隔离，保留 7 天
# 环境变量：
#   PLATFORM_COMPOSE_DIR   租户 compose 根目录（默认 ${PLATFORM_HOST_DATA_DIR:-/opt/cs-bot/data/control}/tenants）
#   BACKUP_DIR             备份根（默认 ./backup）
#   PLATFORM_DOCKER_BIN    docker 可执行（默认 docker）
#   POSTGRES_USER          默认 cs
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TENANT_ROOT="${PLATFORM_COMPOSE_DIR:-${PLATFORM_HOST_DATA_DIR:-/opt/cs-bot/data/control}/tenants}"
BACKUP_BASE="${BACKUP_DIR:-$ROOT/backup}/tenants"
DOCKER="${PLATFORM_DOCKER_BIN:-docker}"
PG_USER="${POSTGRES_USER:-cs}"
DATE="$(date +%Y%m%d_%H%M%S)"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
failed=0

[[ -d "$TENANT_ROOT" ]] || { echo "[backup-tenants] no tenant dir: $TENANT_ROOT"; exit 0; }

for dir in "$TENANT_ROOT"/*/; do
  [[ -f "${dir}docker-compose.yml" ]] || continue
  id="$(basename "$dir")"
  project="csbot-t-$id"
  out="$BACKUP_BASE/$id/$DATE"
  mkdir -p "$out" || { echo "[backup-tenants] mkdir failed: $out" >&2; failed=1; continue; }

  if ! "$DOCKER" compose -p "$project" -f "${dir}docker-compose.yml" exec -T pg \
        pg_dump -U "$PG_USER" -d csbot 2>"$out/pg.err" | gzip > "$out/pg_${id}_${DATE}.sql.gz"; then
    echo "[backup-tenants] pg failed: $id" >&2; failed=1
  fi
  if ! "$DOCKER" compose -p "$project" -f "${dir}docker-compose.yml" exec -T mongo \
        mongodump --archive --gzip 2>"$out/mongo.err" > "$out/mongo_${id}_${DATE}.archive.gz"; then
    echo "[backup-tenants] mongo failed: $id" >&2; failed=1
  fi
  if [[ -d "${dir}data" || -d "${dir}license" ]]; then
    tar -czf "$out/data_${id}_${DATE}.tar.gz" -C "$dir" data license 2>/dev/null \
      || { echo "[backup-tenants] data failed: $id" >&2; failed=1; }
  fi
  find "$BACKUP_BASE/$id" -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
  echo "[backup-tenants] done: $id -> $out"
done

[[ "$failed" == "0" ]] || { echo "[backup-tenants] completed with failures" >&2; exit 1; }
