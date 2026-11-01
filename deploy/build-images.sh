#!/usr/bin/env bash
# 按 deploy/docker-compose.yml 准备六个服务的镜像。
#
#   ./deploy/build-images.sh
#
# 1. 若本地没有 cs-bot-adapter:latest，则 docker load images/*.tar（部署包内的适配层镜像）
# 2. 拉取 nginx / fastgpt / pg / mongo / redis
# 3. 仍然没有适配层镜像、且当前目录是源码树时，才 docker compose build adapter
#
# 分步填写请执行 sudo ./deploy/setup.sh。本脚本只准备镜像。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
COMPOSE=(docker compose -f deploy/docker-compose.yml)
if [[ -f .env ]]; then
  COMPOSE=(docker compose --env-file .env -f deploy/docker-compose.yml)
fi

info() { echo "[build-images] $*"; }
die() { echo "[build-images] ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "未找到 docker"
docker compose version >/dev/null 2>&1 || die "未找到 docker compose v2"
[[ -f deploy/docker-compose.yml ]] || die "缺少 deploy/docker-compose.yml"

have_adapter() {
  docker image inspect cs-bot-adapter:latest >/dev/null 2>&1
}

if ! have_adapter; then
  shopt -s nullglob
  tars=(images/*.tar)
  shopt -u nullglob
  if [[ ${#tars[@]} -gt 0 ]]; then
    for t in "${tars[@]}"; do
      info "加载镜像 $t"
      docker load -i "$t"
    done
  fi
fi

info "拉取公共镜像：nginx fastgpt pg mongo redis"
"${COMPOSE[@]}" pull nginx fastgpt pg mongo redis

if have_adapter; then
  info "适配层镜像 cs-bot-adapter:latest 已在本地"
elif [[ -f deploy/Dockerfile.adapter && -f package.json && -f pnpm-lock.yaml ]]; then
  info "从源码构建适配层镜像 cs-bot-adapter:latest"
  "${COMPOSE[@]}" build adapter
else
  die "没有 cs-bot-adapter:latest。请放入 images/*.tar，或在源码树中执行本脚本"
fi
have_adapter || die "适配层镜像仍不可用"

info "镜像已就绪。下一步：sudo ./deploy/setup.sh（已有 .env 和证书时可 sudo ./deploy/install.sh）"
