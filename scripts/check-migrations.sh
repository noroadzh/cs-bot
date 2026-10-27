#!/usr/bin/env bash
# 校验部署配置覆盖全部 src/**/NNN-*.sql 迁移
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
missing=0
while IFS= read -r f; do
  rel="${f#"$ROOT"/}"
  for target in deploy/docker-compose.yml deploy/Dockerfile.adapter; do
    if ! grep -Fq "$rel" "$target"; then
      echo "[check-migrations] missing $rel in $target" >&2
      missing=1
    fi
  done
done < <(find apps/adapter/src -name '[0-9][0-9][0-9]-*.sql' | sort)
if [[ "$missing" == "1" ]]; then
  echo "[check-migrations] FAILED" >&2
  exit 1
fi
echo "[check-migrations] OK ($(find apps/adapter/src -name '[0-9][0-9][0-9]-*.sql' | wc -l | tr -d ' ') migrations)"
