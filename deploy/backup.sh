#!/usr/bin/env bash
# 每日备份：pg_dump × 2、mongodump、assets（如果存在）
# 用法：./deploy/backup.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backup}"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# 读 .env
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p "$BACKUP_DIR/$DATE"

log() { echo "[backup] $(date +%T) $*"; }
fail() { echo "[backup] FAIL: $*" >&2; exit 1; }

# 1. Postgres
log "postgres dump"
if docker compose -f deploy/docker-compose.yml ps pg >/dev/null 2>&1; then
  docker compose -f deploy/docker-compose.yml exec -T pg \
    pg_dump -U "${POSTGRES_USER:-cs}" -d "${POSTGRES_DB:-csbot}" \
    > "$BACKUP_DIR/$DATE/pg_adapter_${DATE}.sql" \
    || fail "pg_dump adapter"
  docker compose -f deploy/docker-compose.yml exec -T pg \
    pg_dump -U "${POSTGRES_USER:-cs}" -d "fastgpt" \
    > "$BACKUP_DIR/$DATE/pg_fastgpt_${DATE}.sql" 2>/dev/null || log "fastgpt pg skip"
  docker compose -f deploy/docker-compose.yml exec -T pg \
    pg_dump -U "${POSTGRES_USER:-cs}" -d "${CONTROL_PLANE_DB:-csbot_control}" \
    > "$BACKUP_DIR/$DATE/pg_control_${DATE}.sql" \
    || fail "pg_dump control-plane"
else
  log "pg not running, skip"
fi

# 2. Mongo
log "mongo dump"
if docker compose -f deploy/docker-compose.yml ps mongo >/dev/null 2>&1; then
  docker compose -f deploy/docker-compose.yml exec -T mongo \
    mongodump --archive --gzip \
    > "$BACKUP_DIR/$DATE/mongo_${DATE}.archive.gz" \
    || fail "mongodump"
else
  log "mongo not running, skip"
fi

# 3. Assets
if [[ -d data/assets ]]; then
  log "assets archive"
  tar -czf "$BACKUP_DIR/$DATE/assets_${DATE}.tar.gz" -C data assets || fail "assets"
fi

# 3b. 租户实例备份（SaaS）
if [[ -x "$ROOT_DIR/scripts/backup-tenants.sh" ]]; then
  log "tenant instances"
  BACKUP_DIR="$BACKUP_DIR"   PLATFORM_COMPOSE_DIR="${PLATFORM_COMPOSE_DIR:-${PLATFORM_HOST_DATA_DIR:-/opt/cs-bot/data/control}/tenants}"   "$ROOT_DIR/scripts/backup-tenants.sh" || log "tenant backup had failures"
fi

# 4. 清理旧备份
log "cleanup old (keep ${KEEP_DAYS}d)"
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +${KEEP_DAYS} -exec rm -rf {} +

log "done: $BACKUP_DIR/$DATE"
