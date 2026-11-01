#!/usr/bin/env bash
# 生成不含镜像的安装包（交付方内部使用）
#
#   VERSION=0.1.0 ./scripts/package-install.sh
#
# 产物：$OUT_DIR/cs-bot-install-<version>.tar.gz
# 含：一键安装脚本、Compose 与适配层构建脚本、nginx/环境/出厂配置、迁移 SQL、
#     构建适配层所需的源码与锁文件。
# 不含：镜像 tar、源码以外的运行数据、证书、license、SaaS 叠加文件、签名私钥。
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
VERSION="${VERSION:?set VERSION (e.g. 0.1.0)}"
OUT_DIR="${OUT_DIR:-$ROOT/dist-delivery}"
PACKAGE="cs-bot-install-$VERSION"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/cs-bot-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
DEST="$STAGE/$PACKAGE"

fail() { echo "[package-install] ERROR: $*" >&2; exit 1; }

[[ -f "$ROOT/deploy/Dockerfile.adapter" ]] || fail "missing deploy/Dockerfile.adapter"
[[ -f "$ROOT/deploy/build-images.sh" ]] || fail "missing deploy/build-images.sh"
[[ -f "$ROOT/pnpm-lock.yaml" ]] || fail "missing pnpm-lock.yaml"
[[ -f "$ROOT/packages/license-native/Cargo.lock" ]] || fail "missing packages/license-native/Cargo.lock"

mkdir -p "$DEST/apps" "$DEST/packages" "$DEST/deploy/nginx"

copy_top() {
  local rel="$1"
  [[ -f "$ROOT/$rel" ]] || fail "missing required file: $rel"
  cp "$ROOT/$rel" "$DEST/$rel"
}

copy_top package.json
copy_top pnpm-lock.yaml
copy_top pnpm-workspace.yaml
copy_top tsconfig.base.json
copy_top .dockerignore
copy_top .env.template

rsync -a \
  --exclude node_modules --exclude dist --exclude coverage --exclude data \
  "$ROOT/apps/adapter" "$ROOT/apps/admin-web" "$DEST/apps/"
rsync -a \
  --exclude node_modules --exclude dist --exclude target --exclude '*.pem' --exclude '*.key' \
  "$ROOT/packages/shared" "$ROOT/packages/license-native" "$DEST/packages/"
rsync -a --exclude '*.pem' --exclude '*.key' "$ROOT/config" "$DEST/"
rsync -a "$ROOT/scripts" "$DEST/"

for rel in \
  deploy/docker-compose.yml \
  deploy/Dockerfile.adapter \
  deploy/build-images.sh \
  deploy/install.sh \
  deploy/setup.sh \
  deploy/render-admin-allow.sh \
  deploy/init-perms.sh \
  deploy/init-control-db.sh \
  deploy/backup.sh \
  deploy/collect-logs.sh \
  deploy/logrotate.conf \
  deploy/nginx/nginx.conf \
  deploy/nginx/fastgpt-admin-allow.conf
do
  [[ -f "$ROOT/$rel" ]] || fail "missing required file: $rel"
  mkdir -p "$DEST/$(dirname "$rel")"
  cp "$ROOT/$rel" "$DEST/$rel"
done
chmod +x "$DEST/deploy/build-images.sh" "$DEST/deploy/install.sh" "$DEST/deploy/setup.sh" "$DEST/scripts/package-install.sh"

violations=0
while IFS= read -r hit; do
  rel="${hit#"$DEST"/}"
  if [[ "$rel" == images/* ]] \
     || [[ "$rel" =~ \.tar$ ]] \
     || [[ "$rel" =~ (^|/)nginx/certs(/|$) ]] \
     || [[ "$rel" == license/license.lic ]] \
     || [[ "$rel" == docker-compose.saas.yml ]] \
     || [[ "$rel" == docker-compose.control-plane-expose.yml ]] \
     || [[ "$rel" =~ \.(pem|key)$ ]] \
     || [[ "$rel" =~ (^|/)node_modules(/|$) ]] \
     || [[ "$rel" =~ (^|/)tools(/|$) ]]; then
    echo "[package-install] forbidden artifact: $rel" >&2
    violations=1
  fi
done < <(find "$DEST" -mindepth 1)
[[ "$violations" == "0" ]] || fail "forbidden artifacts detected in package"

if command -v sha256sum >/dev/null 2>&1; then HASH="sha256sum"; else HASH="shasum -a 256"; fi
(
  cd "$DEST"
  find . -type f ! -name 'SHA256SUMS.txt' | sed 's|^\./||' | sort | while IFS= read -r f; do
    printf '%s  %s\n' "$($HASH "$f" | awk '{print $1}')" "$f"
  done
) > "$DEST/SHA256SUMS.txt"

mkdir -p "$OUT_DIR"
tar_opts=()
if tar --no-xattrs --version >/dev/null 2>&1; then
  tar_opts+=(--no-xattrs)
fi
COPYFILE_DISABLE=1 tar "${tar_opts[@]}" -czf "$OUT_DIR/$PACKAGE.tar.gz" -C "$STAGE" "$PACKAGE"
echo "[package-install] $OUT_DIR/$PACKAGE.tar.gz"
tar -tzf "$OUT_DIR/$PACKAGE.tar.gz" | grep -E 'deploy/(install|build-images|docker-compose|Dockerfile)|nginx/|\.env.template|config/|images/' | sed 's|^|  |'
