#!/usr/bin/env bash
# 单个租户实例按需恢复（SaaS 形态；概设 §10.5「订阅期内按需恢复」）
#
# 用法：
#   ./scripts/restore-tenant.sh <tenantId> [--date YYYYmmdd_HHMMSS] [--backup-dir DIR] [--dry-run] [--yes]
#
# 默认只打印计划；必须显式 --yes 才会停止容器并写回数据。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TENANT_ROOT="${PLATFORM_COMPOSE_DIR:-${PLATFORM_HOST_DATA_DIR:-/opt/cs-bot/data/control}/tenants}"
TENANT_ID=""
DATE=""
BACKUP_BASE_OVERRIDE=""
YES=0
DRY=0

usage() { sed -n '2,8p' "$0"; }
die() { echo "[restore-tenant] ERROR: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --date) DATE="${2:?--date needs a value}"; shift 2 ;;
    --backup-dir) BACKUP_BASE_OVERRIDE="${2:?--backup-dir needs a value}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "[restore-tenant] ERROR: unknown option: $1" >&2; exit 2 ;;
    *) TENANT_ID="$1"; shift ;;
  esac
done

if [ -z "$TENANT_ID" ]; then
  usage >&2
  die "tenantId is required"
fi

COMPOSE="$TENANT_ROOT/$TENANT_ID/docker-compose.yml"
[ -f "$COMPOSE" ] || die "tenant compose not found: $COMPOSE"

BACKUP_BASE="${BACKUP_BASE_OVERRIDE:-${BACKUP_DIR:-$ROOT/backup}}/tenants/$TENANT_ID"
[ -d "$BACKUP_BASE" ] || die "no backup dir: $BACKUP_BASE"

if [ -z "$DATE" ]; then
  DATE="$( (ls -1 "$BACKUP_BASE" 2>/dev/null || true) | grep -E '^[0-9]{8}_[0-9]{6}$' | sort | tail -1 || true)"
  [ -n "$DATE" ] || die "no backup snapshot under: $BACKUP_BASE"
fi
SRC="$BACKUP_BASE/$DATE"
[ -d "$SRC" ] || die "backup snapshot not found: $SRC"

PG_DUMP="$( (ls "$SRC"/pg_*.sql.gz 2>/dev/null || true) | head -1 || true)"
MONGO_DUMP="$( (ls "$SRC"/mongo_*.archive.gz 2>/dev/null || true) | head -1 || true)"
DATA_TAR="$( (ls "$SRC"/data_*.tar.gz 2>/dev/null || true) | head -1 || true)"
[ -n "$PG_DUMP" ] || die "missing pg dump in $SRC"
[ -n "$MONGO_DUMP" ] || die "missing mongo dump in $SRC"

DOCKER="${PLATFORM_DOCKER_BIN:-docker}"
PROJECT="csbot-t-$TENANT_ID"
PG_USER="${POSTGRES_USER:-cs}"
TENANT_DIR="$TENANT_ROOT/$TENANT_ID"
COMPOSE_CMD=("$DOCKER" compose -p "$PROJECT" -f "$COMPOSE")

echo "[restore-tenant] tenant : $TENANT_ID"
echo "[restore-tenant] compose: $COMPOSE"
echo "[restore-tenant] backup : $SRC"
echo "[restore-tenant] 计划："
echo "  1) ${DOCKER} compose -p $PROJECT -f $COMPOSE stop"
echo "  2) psql: DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
echo "  3) gunzip -c $PG_DUMP | ... exec -T pg psql -U $PG_USER -d csbot -v ON_ERROR_STOP=1"
echo "  4) ... exec -T mongo mongorestore --archive --gzip --drop < $MONGO_DUMP"
if [ -n "$DATA_TAR" ]; then
  echo "  5) tar -xzf $DATA_TAR -C $TENANT_DIR"
else
  echo "  5) 无 data 归档，跳过（仅恢复数据库）"
fi
echo "  6) ${DOCKER} compose -p $PROJECT -f $COMPOSE up -d"

if [ "$DRY" = 1 ]; then
  echo "[restore-tenant] dry-run：未执行任何操作"
  exit 0
fi
[ "$YES" = 1 ] || die "需要 --yes 才会执行（先用 --dry-run 查看计划）"

echo "[restore-tenant] 停止租户实例"
"${COMPOSE_CMD[@]}" stop

echo "[restore-tenant] 恢复 PostgreSQL"
"${COMPOSE_CMD[@]}" exec -T pg psql -U "$PG_USER" -d csbot -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
gunzip -c "$PG_DUMP" | "${COMPOSE_CMD[@]}" exec -T pg psql -U "$PG_USER" -d csbot -v ON_ERROR_STOP=1

echo "[restore-tenant] 恢复 Mongo"
"${COMPOSE_CMD[@]}" exec -T mongo mongorestore --archive --gzip --drop < "$MONGO_DUMP"

if [ -n "$DATA_TAR" ]; then
  echo "[restore-tenant] 解包 data/license"
  tar -xzf "$DATA_TAR" -C "$TENANT_DIR"
fi

echo "[restore-tenant] 启动租户实例"
"${COMPOSE_CMD[@]}" up -d
"${COMPOSE_CMD[@]}" ps
echo "[restore-tenant] done"
