#!/usr/bin/env bash
# 生成交付校验清单：镜像 digest + 交付文件 SHA-256
# 用法：IMAGE=cs-bot-adapter:1.0.0 ./scripts/release-sums.sh [outfile]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/SHA256SUMS}"
if command -v sha256sum >/dev/null 2>&1; then HASH="sha256sum"; else HASH="shasum -a 256"; fi

: > "$OUT"
if [[ -n "${IMAGE:-}" ]] && command -v docker >/dev/null 2>&1; then
  DIGEST="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
  [[ -n "$DIGEST" ]] && printf 'image-digest  %s  %s\n' "$DIGEST" "$IMAGE" >> "$OUT"
fi
find "$ROOT/deploy" "$ROOT/config" "$ROOT/packages/license-native/prebuilds" \
  -type f 2>/dev/null | sort | while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  printf '%s  %s\n' "$($HASH "$f" | awk '{print $1}')" "$rel" >> "$OUT"
done
echo "$OUT"
