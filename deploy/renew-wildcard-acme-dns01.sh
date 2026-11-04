#!/usr/bin/env bash
# SaaS 通配域 ACME DNS-01 续期（不替代私有化单域 HTTP-01 脚本）。
#
# 必填：
#   PLATFORM_WILDCARD_BASE_DOMAIN  例：saas.example.com（脚本会签 *.saas.example.com）
#   PLATFORM_WILDCARD_CERT_DIR     共享材料目录（写入 fullchain.pem / privkey.pem 或 wildcard.crt/.key）
#
# 二选一：
#   PLATFORM_CERT_CMD              与平台 API 相同：<cmd> '<*.domain>' '<dir>'，脚本内负责 DNS-01
#   CERTBOT_DNS_*                  使用 certbot DNS 插件（见下）
#
# DNS 插件（仅当未设置 PLATFORM_CERT_CMD 时）：
#   CERTBOT_DNS_PLUGIN             例：dns-cloudflare
#   CERTBOT_DNS_CREDENTIALS        插件凭据文件路径（cloudflare 等）
#   CERTBOT_EMAIL                  可选 ACME 账户邮箱
#   CERTBOT_EXTRA_ARGS             额外 certbot 参数（空格分隔，谨慎使用）
#
# 用法：
#   ./deploy/renew-wildcard-acme-dns01.sh [--dry-run]
#
# 失败时 exit 1；成功时刷新 PLATFORM_WILDCARD_CERT_DIR 下材料。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

die() { echo "[renew-wildcard-acme] ERROR: $*" >&2; exit 1; }
info() { echo "[renew-wildcard-acme] $*"; }

BASE="${PLATFORM_WILDCARD_BASE_DOMAIN:-}"
OUT_DIR="${PLATFORM_WILDCARD_CERT_DIR:-}"
[[ -n "$BASE" ]] || die "请设置 PLATFORM_WILDCARD_BASE_DOMAIN"
[[ -n "$OUT_DIR" ]] || die "请设置 PLATFORM_WILDCARD_CERT_DIR"

if [[ "$BASE" == *'*'* ]]; then
  WILD="$BASE"
  BASE_CLEAN="${BASE#*.}"
else
  WILD="*.${BASE}"
  BASE_CLEAN="$BASE"
fi

CERT_CMD="${PLATFORM_CERT_CMD:-}"

write_material_from_live() {
  local live_dir="$1"
  [[ -f "$live_dir/fullchain.pem" && -f "$live_dir/privkey.pem" ]] || die "未找到 $live_dir 下的 fullchain.pem/privkey.pem"
  mkdir -p "$OUT_DIR"
  cp "$live_dir/fullchain.pem" "$OUT_DIR/fullchain.pem"
  cp "$live_dir/privkey.pem" "$OUT_DIR/privkey.pem"
  chmod 644 "$OUT_DIR/fullchain.pem"
  chmod 600 "$OUT_DIR/privkey.pem"
  info "已写入 $OUT_DIR/fullchain.pem 与 privkey.pem"
}

if [[ "$DRY_RUN" == "1" ]]; then
  info "dry-run: base=$BASE wild=$WILD out=$OUT_DIR cert_cmd=${CERT_CMD:-<certbot>}"
  exit 0
fi

if [[ -n "$CERT_CMD" ]]; then
  info "执行 PLATFORM_CERT_CMD: $CERT_CMD $WILD $OUT_DIR"
  "$CERT_CMD" "$WILD" "$OUT_DIR"
  exit 0
fi

PLUGIN="${CERTBOT_DNS_PLUGIN:-}"
CREDS="${CERTBOT_DNS_CREDENTIALS:-}"
[[ -n "$PLUGIN" ]] || die "未设置 PLATFORM_CERT_CMD 时需配置 CERTBOT_DNS_PLUGIN（或设置 PLATFORM_CERT_CMD）"
command -v certbot >/dev/null 2>&1 || die "未找到 certbot"

ARGS=(certonly --non-interactive --agree-tos --preferred-challenges dns)
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  ARGS+=(--email "$CERTBOT_EMAIL")
else
  ARGS+=(--register-unsafely-without-email)
fi
ARGS+=(-d "$WILD" -d "$BASE_CLEAN")
# shellcheck disable=SC2206
EXTRA=(${CERTBOT_EXTRA_ARGS:-})
ARGS+=("${EXTRA[@]}")
ARGS+=("--${PLUGIN}")
[[ -n "$CREDS" ]] && ARGS+=("--${PLUGIN}-credentials" "$CREDS")

info "certbot DNS-01: ${ARGS[*]}"
certbot "${ARGS[@]}"

LIVE="/etc/letsencrypt/live/${BASE_CLEAN}"
[[ -d "$LIVE" ]] || LIVE="/etc/letsencrypt/live/${WILD#\*\.}"
write_material_from_live "$LIVE"
