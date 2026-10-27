#!/usr/bin/env bash
# 验收测试一键执行（mock 全栈 + ab 压测 + 报告）
#
# 用法：
#   ./scripts/acceptance.sh                    # 自动起本地 postgres:16（Docker）
#   TEST_PG_URL=postgresql://... ./scripts/... # 使用已有 PG
#   ACCEPTANCE_KEEP_PG=1 ./scripts/...         # 保留临时 PG 容器
#
# 产物：artifacts/acceptance/ab-report-*.{json,txt}
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_PORT="${ACCEPTANCE_PG_PORT:-55432}"
PG_NAME="${ACCEPTANCE_PG_NAME:-csbot-acceptance-pg}"
STARTED_PG=0

cleanup() {
  if [[ "$STARTED_PG" == "1" && "${ACCEPTANCE_KEEP_PG:-0}" != "1" ]]; then
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${TEST_PG_URL:-}" ]]; then
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "[acceptance] TEST_PG_URL 未设置且 Docker 不可用。" >&2
    echo "[acceptance] 请设置 TEST_PG_URL=postgresql://user:pass@host:port/db 后重试。" >&2
    exit 1
  fi
  if ! docker image inspect postgres:16 >/dev/null 2>&1; then
    echo "[acceptance] 拉取 postgres:16 ..."
    docker pull postgres:16
  fi
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$PG_NAME" \
    -e POSTGRES_USER=cs -e POSTGRES_PASSWORD=cs -e POSTGRES_DB=csbot_test \
    -p "${PG_PORT}:5432" postgres:16 >/dev/null
  STARTED_PG=1
  echo "[acceptance] 等待 postgres 就绪 (port ${PG_PORT}) ..."
  for _ in $(seq 1 60); do
    if docker exec "$PG_NAME" pg_isready -U cs -d csbot_test >/dev/null 2>&1; then break; fi
    sleep 1
  done
  export TEST_PG_URL="postgresql://cs:cs@127.0.0.1:${PG_PORT}/csbot_test"
fi

export TEST_PG_URL
echo "[acceptance] TEST_PG_URL=${TEST_PG_URL}"
cd "$ROOT"
pnpm --filter @cs-bot/adapter test:acceptance
echo "[acceptance] 通过。报告目录：${ROOT}/artifacts/acceptance"
