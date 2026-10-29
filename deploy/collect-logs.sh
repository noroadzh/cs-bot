#!/usr/bin/env bash
# 收集排障日志（技术支持用）
#
# 用法：
#   sudo ./deploy/collect-logs.sh                 # 最近 24h
#   ./deploy/collect-logs.sh --since 7d --out /tmp
#   ./deploy/collect-logs.sh --dry-run            # 只打印将收集的内容
#
# 产物：<out>/logs-bundle-<YYYYmmdd-HHMMSS>.tar.gz（600 权限）
# 内容：各容器最近日志、落盘日志（adapter/nginx/control-plane）、compose ps、
#       系统/版本/磁盘信息。不包含 .env 与密钥。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE="deploy/docker-compose.yml"
SINCE="24h"
OUT="${ROOT}/backup"
DRY=0
SERVICES=(adapter nginx fastgpt pg mongo redis)

while [ $# -gt 0 ]; do
  case "$1" in
    --since) SINCE="${2:?--since needs a value}"; shift 2 ;;
    --out) OUT="${2:?--out needs a value}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "[collect-logs] ERROR: unknown option: $1" >&2; exit 2 ;;
  esac
done

info() { echo "[collect-logs] $*"; }

TS="$(date +%Y%m%d-%H%M%S)"
BUNDLE="${OUT}/logs-bundle-${TS}.tar.gz"

if [ "${DRY}" = 1 ]; then
  info "将收集以下内容（since=${SINCE}）并打包到 ${BUNDLE}："
  echo "  docker compose -f ${COMPOSE} ps"
  for s in "${SERVICES[@]}"; do
    echo "  docker compose -f ${COMPOSE} logs --no-color --timestamps --since ${SINCE} $s"
  done
  echo "  运行中的 control-plane 容器日志（如存在）"
  echo "  落盘日志: logs/*.log  deploy/nginx/logs/*  logs/control-plane/*"
  echo "  系统信息: uname / docker version / docker compose version / df -h / docker image ls"
  exit 0
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/csbot-logs.XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT
COL="${STAGE}/collect"
mkdir -p "${COL}"
cd "${ROOT}"

info "收集容器状态与日志（since=${SINCE}）"
docker compose -f "${COMPOSE}" ps > "${COL}/compose-ps.txt" 2>&1 || true
for s in "${SERVICES[@]}"; do
  docker compose -f "${COMPOSE}" logs --no-color --timestamps --since "${SINCE}" "$s" \
    > "${COL}/container-$s.log" 2>&1 || echo "(no logs for $s)" > "${COL}/container-$s.log"
done

cp_control_plane_logs() {
  local ids
  ids="$(docker ps --format '{{.ID}} {{.Names}}' 2>/dev/null | awk '/control-plane/ {print $1}')"
  [ -z "$ids" ] && return 0
  local i=0
  for id in $ids; do
    i=$((i + 1))
    docker logs --timestamps --since "${SINCE}" "$id" > "${COL}/container-control-plane-$i.log" 2>&1 || true
  done
}
cp_control_plane_logs

info "收集落盘日志"
for d in "logs" "deploy/nginx/logs" "logs/control-plane"; do
  [ -d "${ROOT}/$d" ] || continue
  find "${ROOT}/$d" -maxdepth 1 -type f \( -name '*.log' -o -name '*.log.*' \) 2>/dev/null | while IFS= read -r f; do
    rel="${f#"${ROOT}"/}"
    mkdir -p "${COL}/host/$(dirname "$rel")"
    cp "$f" "${COL}/host/$rel" 2>/dev/null || true
  done
done

info "收集系统信息"
{
  echo "== uname =="; uname -a 2>&1 || true
  echo; echo "== docker =="; docker version 2>&1 || true
  echo; echo "== compose =="; docker compose version 2>&1 || true
  echo; echo "== disk =="; df -h 2>&1 || true
  echo; echo "== images =="; docker image ls 2>&1 | grep -E 'cs-bot|fastgpt|pgvector|mongo|redis|nginx' || true
} > "${COL}/system.txt"

mkdir -p "${OUT}"
tar -czf "${BUNDLE}" -C "${STAGE}" collect
chmod 600 "${BUNDLE}"
info "已生成：${BUNDLE}"
warn="日志可能包含用户问题与联系方式，发送前请确认脱敏；压缩包权限已设为 600。"
info "$warn"
echo "${BUNDLE}"
