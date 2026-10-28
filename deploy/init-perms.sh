#!/usr/bin/env bash
# 首次部署/升级后校正宿主目录归属，使非 root 容器可写。
# 用法：sudo ./deploy/init-perms.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UID_GID="${CSBOT_UID:-65532}:${CSBOT_GID:-65532}"

dirs=(
  "$ROOT/data"
  "$ROOT/logs"
  "$ROOT/license"
  "$ROOT/data/tenants"
  "$ROOT/backup/tenants"
)
for d in "${dirs[@]}"; do
  mkdir -p "$d"
  chown -R "$UID_GID" "$d"
  echo "[init-perms] $d -> $UID_GID"
done

# TLS 证书目录只读挂载，属主 root 即可
if [[ ! -r "$ROOT/deploy/nginx/certs/fullchain.pem" ]]; then
  echo "[init-perms] WARN: nginx 证书缺失，请先放置 deploy/nginx/certs/fullchain.pem 与 privkey.pem" >&2
fi
