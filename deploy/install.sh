#!/usr/bin/env bash
# 一键部署（私有化形态 A）
#
# 用法：
#   sudo ./deploy/install.sh              # 预检 + 建目录 + 权限 + 启动 + 健康等待
#   ./deploy/install.sh --check           # 只预检（远程自检）
#   ./deploy/install.sh --dry-run         # 只打印将执行的动作
#   ./deploy/install.sh --skip-perms      # 跳过目录归属校正（无 sudo）
#
# 只启动基线 6 服务（adapter/fastgpt/pg/mongo/redis/nginx）；SaaS 控制面另用
# docker-compose.saas.yml 叠加。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE="deploy/docker-compose.yml"
MODE="install"
SKIP_PERMS=0
HEALTH_URL="${INSTALL_HEALTH_URL:-https://127.0.0.1/healthz}"
HEALTH_TIMEOUT="${INSTALL_HEALTH_TIMEOUT:-120}"

for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --dry-run) MODE="dry" ;;
    --skip-perms) SKIP_PERMS=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "[install] ERROR: unknown option: $arg" >&2; exit 2 ;;
  esac
done

info() { echo "[install] $*"; }
warn() { echo "[install] WARN: $*" >&2; }
die() { echo "[install] ERROR: $*" >&2; exit 1; }

REQUIRED_ENV=(
  WECHAT_CORP_ID WECHAT_AGENT_ID WECHAT_AGENT_SECRET
  WECHAT_TOKEN WECHAT_ENCODING_AES_KEY FASTGPT_API_KEY
)

missing=()

env_value() {
  awk -F= -v k="$1" '$1==k { sub(/^[^=]*=/, ""); print; exit }' "$ROOT/.env" 2>/dev/null \
    | sed 's/^["'\'']//; s/["'\'']$//'
}

preflight() {
  command -v docker >/dev/null 2>&1 || missing+=("docker CLI")
  if command -v docker >/dev/null 2>&1; then
    docker compose version >/dev/null 2>&1 || missing+=("docker compose v2")
  fi
  [ -f "$ROOT/$COMPOSE" ] || missing+=("$COMPOSE")
  [ -f "$ROOT/.env" ] || missing+=(".env（先复制 .env.template 并填写必填项）")
  if [ -f "$ROOT/.env" ]; then
    for k in "${REQUIRED_ENV[@]}"; do
      [ -n "$(env_value "$k")" ] || missing+=(".env:$k")
    done
  fi
  for f in deploy/nginx/certs/fullchain.pem deploy/nginx/certs/privkey.pem license/license.lic; do
    [ -f "$ROOT/$f" ] || missing+=("$f")
  done
  local image_ok=0
  if command -v docker >/dev/null 2>&1 && docker image inspect cs-bot-adapter:latest >/dev/null 2>&1; then
    image_ok=1
  fi
  local tars=("$ROOT"/images/*.tar)
  if [ -e "${tars[0]}" ]; then image_ok=1; fi
  [ "$image_ok" = 1 ] || missing+=("adapter 镜像（本地 cs-bot-adapter:latest 或 images/*.tar）")
}

report_missing() {
  local m
  for m in "${missing[@]}"; do echo "  - 缺少: $m" >&2; done
}

preflight
if [ "${#missing[@]}" -gt 0 ]; then
  if [ "$MODE" = "dry" ]; then
    warn "预检存在缺失项（dry-run 继续打印计划）"
    report_missing
  else
    report_missing
    die "预检未通过，未执行任何变更"
  fi
fi
[ "$MODE" = "check" ] && { info "预检通过"; exit 0; }

COMPOSE_CMD=(docker compose -f "$COMPOSE")

if [ "$MODE" = "dry" ]; then
  info "将执行："
  echo "  mkdir -p data data/assets data/import logs backup license config"
  if [ "$SKIP_PERMS" = 0 ]; then
    echo "  sudo deploy/init-perms.sh"
  else
    echo "  # 跳过权限校正（--skip-perms）"
  fi
  echo "  docker load -i images/*.tar（仅当本地无 adapter 镜像）"
  echo "  docker compose -f $COMPOSE up -d"
  echo "  curl -k ${HEALTH_URL}（最多 ${HEALTH_TIMEOUT}s）"
  echo "  docker compose -f $COMPOSE ps"
  exit 0
fi

cd "$ROOT"
info "准备目录"
mkdir -p data data/assets data/import logs backup license config

if [ "$SKIP_PERMS" = 0 ]; then
  if [ "$(id -u)" = "0" ]; then
    info "校正宿主目录归属"
    "$ROOT/deploy/init-perms.sh"
  else
    warn "非 root，跳过目录归属校正；请用 sudo 重跑，或显式加 --skip-perms"
  fi
else
  info "跳过目录归属校正（--skip-perms）"
fi

shopt -s nullglob
tars=("$ROOT"/images/*.tar)
shopt -u nullglob
if [ "${#tars[@]}" -gt 0 ] && ! docker image inspect cs-bot-adapter:latest >/dev/null 2>&1; then
  for t in "${tars[@]}"; do
    info "加载镜像 $t"
    docker load -i "$t"
  done
fi

info "启动基线服务"
"${COMPOSE_CMD[@]}" up -d

info "等待健康检查（最多 ${HEALTH_TIMEOUT}s）"
deadline=$((SECONDS + HEALTH_TIMEOUT))
healthy=0
while [ "$SECONDS" -lt "$deadline" ]; do
  code="$(curl -k -s -o /dev/null -w '%{http_code}' "${HEALTH_URL}" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" != 1 ]; then
  "${COMPOSE_CMD[@]}" logs --tail=50 adapter >&2 || true
  die "健康检查超时（${HEALTH_URL}）；请查看上方日志"
fi

info "部署完成"
"${COMPOSE_CMD[@]}" ps
cat <<TIPS

  健康检查：${HEALTH_URL}  -> 200
  访问地址：https://<你的域名>/healthz
  查看日志：docker compose -f $COMPOSE logs -f adapter
  停止服务：docker compose -f $COMPOSE stop
TIPS
