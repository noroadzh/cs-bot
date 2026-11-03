#!/usr/bin/env bash
# 私有化：用 Let's Encrypt 申请公网证书，并安装续期后覆盖 nginx pem 的 hook。
#
#   sudo ./deploy/issue-letsencrypt.sh issue <域名> [邮箱]
#   sudo ./deploy/issue-letsencrypt.sh install-renew-hook <域名>
#
# 首次申请建议在 nginx 启动前执行（--standalone 占用 80）。
# 续期时 hook 会短暂 stop nginx，拷贝 pem，再 up -d nginx。
# 不是自签：Let's Encrypt 是受信任公网 CA，企微回调可校验通过。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CERT_DIR="$ROOT/deploy/nginx/certs"
COMPOSE=(docker compose --env-file "$ROOT/.env" -f "$ROOT/deploy/docker-compose.yml")
[[ -f "$ROOT/.env" ]] || COMPOSE=(docker compose -f "$ROOT/deploy/docker-compose.yml")

die() { echo "[issue-letsencrypt] ERROR: $*" >&2; exit 1; }
info() { echo "[issue-letsencrypt] $*"; }

need_root() {
  [[ "$(id -u)" == "0" ]] || die "请用 root 执行（sudo）"
}

need_certbot() {
  if ! command -v certbot >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      info "安装 certbot"
      apt-get update -y
      apt-get install -y certbot
    else
      die "未找到 certbot，请先安装后再执行"
    fi
  fi
}

copy_live() {
  local domain="$1"
  local live="/etc/letsencrypt/live/$domain"
  [[ -f "$live/fullchain.pem" && -f "$live/privkey.pem" ]] || die "未找到 $live 下的证书"
  mkdir -p "$CERT_DIR"
  cp "$live/fullchain.pem" "$CERT_DIR/fullchain.pem"
  cp "$live/privkey.pem" "$CERT_DIR/privkey.pem"
  chmod 644 "$CERT_DIR/fullchain.pem"
  chmod 600 "$CERT_DIR/privkey.pem"
  info "已写入 $CERT_DIR/fullchain.pem 与 privkey.pem"
}

cmd_issue() {
  local domain="${1:-}" email="${2:-}"
  [[ -n "$domain" ]] || die "用法: $0 issue <域名> [邮箱]"
  need_root
  need_certbot
  # nginx 若已占用 80，standalone 会失败；提示先停
  if ss -lnt 2>/dev/null | grep -q ':80 '; then
    info "检测到 80 端口已被占用。将尝试 stop nginx 后再申请。"
    (cd "$ROOT" && "${COMPOSE[@]}" stop nginx) || true
  fi
  local args=(certonly --standalone --non-interactive --agree-tos --preferred-challenges http -d "$domain")
  if [[ -n "$email" ]]; then
    args+=(--email "$email")
  else
    args+=(--register-unsafely-without-email)
  fi
  info "申请 Let's Encrypt 证书: $domain"
  certbot "${args[@]}"
  copy_live "$domain"
  cmd_install_renew_hook "$domain"
}

cmd_install_renew_hook() {
  local domain="${1:-}"
  [[ -n "$domain" ]] || die "用法: $0 install-renew-hook <域名>"
  need_root
  local hook_dir="/etc/letsencrypt/renewal-hooks/deploy"
  mkdir -p "$hook_dir"
  local hook="$hook_dir/cs-bot-nginx-$domain.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# certbot renew 成功后：覆盖 cs-bot nginx 证书并重启 nginx
set -euo pipefail
ROOT="$ROOT"
DOMAIN="$domain"
LIVE="/etc/letsencrypt/live/\$DOMAIN"
CERT_DIR="\$ROOT/deploy/nginx/certs"
cp "\$LIVE/fullchain.pem" "\$CERT_DIR/fullchain.pem"
cp "\$LIVE/privkey.pem" "\$CERT_DIR/privkey.pem"
chmod 644 "\$CERT_DIR/fullchain.pem"
chmod 600 "\$CERT_DIR/privkey.pem"
cd "\$ROOT"
if [[ -f "\$ROOT/.env" ]]; then
  docker compose --env-file "\$ROOT/.env" -f "\$ROOT/deploy/docker-compose.yml" up -d nginx
else
  docker compose -f "\$ROOT/deploy/docker-compose.yml" up -d nginx
fi
EOF
  chmod 700 "$hook"
  info "已安装续期 hook: $hook"
  info "系统会定期执行 certbot renew；也可手动：sudo certbot renew --dry-run"
}

case "${1:-}" in
  issue) shift; cmd_issue "$@" ;;
  install-renew-hook) shift; cmd_install_renew_hook "$@" ;;
  -h|--help|"")
    sed -n '2,12p' "$0"
    ;;
  *) die "未知命令: $1（issue | install-renew-hook）" ;;
esac
