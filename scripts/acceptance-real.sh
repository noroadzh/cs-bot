#!/usr/bin/env bash
# 可选：真实 6 容器 compose 冒烟（nginx/adapter/fastgpt/pg/mongo/redis）
#
# 默认跳过；显式开启：
#   REAL_COMPOSE=1 ./scripts/acceptance-real.sh
#   REAL_COMPOSE=1 REAL_COMPOSE_KEEP=1 ...   # 保留环境便于排查
#
# 无网络 / 无 Docker 时打印 skip 并退出 0（nightly 可直接接入）。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/deploy/docker-compose.yml"

skip() { echo "[acceptance-real] skipped: $1"; exit 0; }

[[ "${REAL_COMPOSE:-0}" == "1" ]] || skip "set REAL_COMPOSE=1 to enable"
command -v docker >/dev/null 2>&1 || skip "docker not installed"
docker info >/dev/null 2>&1 || skip "docker daemon unavailable"
command -v curl >/dev/null 2>&1 || skip "curl not installed"
docker compose version >/dev/null 2>&1 || skip "docker compose plugin unavailable"
[[ -f "$COMPOSE_FILE" ]] || skip "compose file missing"

# registry 连通性（401 也算可达）
code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' https://registry-1.docker.io/v2/ || echo 000)"
[[ "$code" != "000" ]] || skip "no registry network"

echo "[acceptance-real] 启动 6 容器 ..."
if ! docker compose -f "$COMPOSE_FILE" up -d --build --wait; then
  echo "[acceptance-real] compose up 失败，最近日志：" >&2
  docker compose -f "$COMPOSE_FILE" ps >&2 || true
  docker compose -f "$COMPOSE_FILE" logs --tail=80 >&2 || true
  [[ "${REAL_COMPOSE_KEEP:-0}" == "1" ]] || docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
  exit 1
fi

status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(docker compose -f "$COMPOSE_FILE" ps -q adapter)" 2>/dev/null || echo unknown)"
echo "[acceptance-real] adapter status: $status"

if [[ "${REAL_COMPOSE_KEEP:-0}" != "1" ]]; then
  docker compose -f "$COMPOSE_FILE" down -v >/dev/null 2>&1 || true
fi

if [[ "$status" != "healthy" && "$status" != "running" ]]; then
  echo "[acceptance-real] adapter 未就绪: $status" >&2
  exit 1
fi

echo "[acceptance-real] 冒烟通过"
