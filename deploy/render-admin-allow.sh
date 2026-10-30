#!/usr/bin/env bash
# 生成 FastGPT 管理后台访问白名单（deploy/nginx/fastgpt-admin-allow.conf）
#
# 用法：
#   ./deploy/render-admin-allow.sh                       # 读 .env 的 FASTGPT_ADMIN_ALLOW_CIDRS
#   ./deploy/render-admin-allow.sh "10.0.0.0/8,203.0.113.5"
#   ROOT_DIR=/tmp/x ./deploy/render-admin-allow.sh       # 测试用
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
OUT="$ROOT/deploy/nginx/fastgpt-admin-allow.conf"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  sed -n '2,10p' "$0"
  exit 0
fi

raw="${1:-}"
if [ -z "$raw" ] && [ -f "$ROOT/.env" ]; then
  raw="$(awk -F= '$1=="FASTGPT_ADMIN_ALLOW_CIDRS" { sub(/^[^=]*=/, ""); print; exit }' "$ROOT/.env" \
    | sed 's/^["'\'']//; s/["'\'']$//')"
fi

mkdir -p "$(dirname "$OUT")"
TMP="$OUT.tmp"
{
  echo "# 由 deploy/render-admin-allow.sh 生成；来源 FASTGPT_ADMIN_ALLOW_CIDRS"
  echo "# 请勿手工放宽到 0.0.0.0/0"
  count=0
  for c in $(echo "$raw" | tr ',' ' '); do
    [ -z "$c" ] && continue
    case "$c" in
      *[!0-9a-fA-F:./]*)
        echo "[render-admin-allow] ERROR: 非法 CIDR/IP: $c" >&2
        exit 2
        ;;
    esac
    echo "allow $c;"
    count=$((count + 1))
  done
  echo "deny all;"
  echo "# allowed_cidrs=$count" >&2
} > "$TMP"
mv "$TMP" "$OUT"

echo "[render-admin-allow] wrote $OUT (allowed=${count:-0})"
