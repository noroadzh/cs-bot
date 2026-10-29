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
SAAS="deploy/docker-compose.saas.yml"
if [[ ! -f "$SAAS" ]]; then
  echo "[check-migrations] missing $SAAS" >&2
  missing=1
else
  # SaaS 叠加文件若引用迁移 SQL，文件必须存在
  while IFS= read -r rel; do
    [[ -z "$rel" ]] && continue
    if [[ ! -f "$rel" ]]; then
      echo "[check-migrations] $SAAS references missing $rel" >&2
      missing=1
    fi
  done < <(grep -oE 'apps/adapter/src/[A-Za-z0-9_./-]+\.sql' "$SAAS" 2>/dev/null | sort -u || true)
fi

if [[ "$missing" == "1" ]]; then
  echo "[check-migrations] FAILED" >&2
  exit 1
fi
echo "[check-migrations] OK ($(find apps/adapter/src -name '[0-9][0-9][0-9]-*.sql' | wc -l | tr -d ' ') migrations)"
