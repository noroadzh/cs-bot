#!/usr/bin/env bash
# 生成客户私有化部署包（白名单，交付方内部使用）
#
# 用法：
#   VERSION=1.0.0 ./scripts/package-delivery.sh
#   VERSION=1.0.0 IMAGE_TAR=/path/adapter.tar ./scripts/package-delivery.sh
#
# 产物：$OUT_DIR/cs-bot-deploy-<version>.tar.gz
# 内容：deploy/（基线编排、nginx 配置、运维脚本）、config/ 出厂文件、
#       apps/adapter/src/**/*.sql 迁移、.env.template、images/（可选）、SHA256SUMS.txt
# 禁止：源码、tools/、签发密钥、SaaS 叠加文件、本地证书、license/license.lic、data/、logs/
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VERSION="${VERSION:?set VERSION (e.g. 1.0.0)}"
OUT_DIR="${OUT_DIR:-$ROOT/dist-delivery}"
PACKAGE="cs-bot-deploy-$VERSION"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cs-bot-pkg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$PACKAGE"
mkdir -p "$DEST"

fail() { echo "[package-delivery] ERROR: $*" >&2; exit 1; }

copy_file() {
  local rel="$1"
  [[ -f "$ROOT/$rel" ]] || fail "missing required file: $rel"
  mkdir -p "$DEST/$(dirname "$rel")"
  cp "$ROOT/$rel" "$DEST/$rel"
}

# --- 白名单 ---
copy_file deploy/docker-compose.yml
copy_file deploy/nginx/nginx.conf
copy_file deploy/nginx/fastgpt-admin-allow.conf
copy_file deploy/init-perms.sh
copy_file deploy/install.sh
copy_file deploy/collect-logs.sh
copy_file deploy/init-control-db.sh
copy_file deploy/backup.sh
copy_file deploy/logrotate.conf
copy_file .env.template

[[ -d "$ROOT/config" ]] || fail "missing required directory: config/"
cp -R "$ROOT/config" "$DEST/config"

# 迁移 SQL（全新安装由 compose 挂载到 pg 初始化目录）
while IFS= read -r sql; do
  rel="${sql#"$ROOT"/}"
  mkdir -p "$DEST/$(dirname "$rel")"
  cp "$sql" "$DEST/$rel"
done < <(find "$ROOT/apps/adapter/src" -name '[0-9][0-9][0-9]-*.sql' | sort)

# 可选镜像 tar
if [[ -n "${IMAGE_TAR:-}" ]]; then
  [[ -f "$IMAGE_TAR" ]] || fail "IMAGE_TAR not found: $IMAGE_TAR"
  mkdir -p "$DEST/images"
  cp "$IMAGE_TAR" "$DEST/images/"
fi

# --- 禁止清单二次扫描（产物内） ---
violations=0
while IFS= read -r hit; do
  rel="${hit#"$DEST"/}"
  if [[ "$rel" =~ (^|/)tools(/|$) ]] \
     || [[ "$rel" == docker-compose.saas.yml ]] \
     || [[ "$rel" == docker-compose.control-plane-expose.yml ]] \
     || [[ "$rel" =~ (^|/)nginx/certs(/|$) ]] \
     || [[ "$rel" == license/license.lic ]] \
     || [[ "$rel" =~ (^|/)data(/|$) ]] \
     || [[ "$rel" =~ (^|/)logs(/|$) ]] \
     || [[ "$rel" =~ \.(pem|key|ts)$ ]] \
     || [[ "$rel" == *.js.map ]] \
     || [[ "$rel" =~ (^|/)node_modules(/|$) ]]; then
    echo "[package-delivery] forbidden artifact: $rel" >&2
    violations=1
  fi
done < <(find "$DEST" -mindepth 1)
if [[ "$violations" == "1" ]]; then
  fail "internal artifacts detected in package"
fi

# --- SHA256SUMS ---
if command -v sha256sum >/dev/null 2>&1; then HASH="sha256sum"; else HASH="shasum -a 256"; fi
(
  cd "$DEST"
  find . -type f ! -name 'SHA256SUMS.txt' | sed 's|^\./||' | sort | while IFS= read -r f; do
    printf '%s  %s\n' "$($HASH "$f" | awk '{print $1}')" "$f"
  done
) > "$DEST/SHA256SUMS.txt"

mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/$PACKAGE.tar.gz" -C "$STAGE" "$PACKAGE"

echo "[package-delivery] $OUT_DIR/$PACKAGE.tar.gz"
tar -tzf "$OUT_DIR/$PACKAGE.tar.gz" | sed 's|^|  |'
