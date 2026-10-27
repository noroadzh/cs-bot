#!/usr/bin/env bash
# 租户实例升级/快照/健康/回滚（由 UpgradeOrchestrator 调用）
# 用法: tenant-upgrade.sh <snapshot|swap|health|rollback> <tenantId> [tag]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CMD="${1:?command required}"
TENANT_ID="${2:?tenantId required}"
TAG="${3:-}"
COMPOSE_DIR="${PLATFORM_COMPOSE_DIR:-$ROOT/data/tenants}/$TENANT_ID"
PROJECT="csbot-t-$TENANT_ID"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

case "$CMD" in
  snapshot)
    mkdir -p "$COMPOSE_DIR/snapshots"
    OUT="$COMPOSE_DIR/snapshots/$(date +%Y%m%dT%H%M%S).sql.gz"
    compose exec -T pg pg_dumpall -U "${POSTGRES_USER:-cs}" | gzip > "$OUT"
    echo "$OUT"
    ;;
  swap)
    [[ -n "$TAG" ]] || { echo "tag required for swap" >&2; exit 2; }
    PREV="$(cat "$COMPOSE_DIR/.image-tag" 2>/dev/null || echo latest)"
    echo "$PREV" > "$COMPOSE_DIR/.previous-tag"
    echo "$TAG" > "$COMPOSE_DIR/.image-tag"
    CSBOT_IMAGE="$TAG" compose up -d
    ;;
  health)
    CID="$(compose ps -q adapter)"
    [[ -n "$CID" ]] || { echo "adapter container not found" >&2; exit 1; }
    STATUS="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID")"
    echo "$STATUS"
    [[ "$STATUS" == "healthy" || "$STATUS" == "running" ]]
    ;;
  rollback)
    PREV="$(cat "$COMPOSE_DIR/.previous-tag" 2>/dev/null || echo latest)"
    CSBOT_IMAGE="$PREV" compose up -d
    echo "$PREV" > "$COMPOSE_DIR/.image-tag"
    ;;
  *)
    echo "unknown command: $CMD" >&2
    exit 2
    ;;
esac
