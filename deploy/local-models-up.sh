#!/usr/bin/env bash
# 增项 D：拉起本地模型栈并健康检查 + 拉取 embedding 模型
# 用法：./deploy/local-models-up.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_FILE="deploy/local-models-compose.yml"
VLLM_HEALTH="${VLLM_HEALTH:-http://127.0.0.1:8000/health}"
XINF_HEALTH="${XINF_HEALTH:-http://127.0.0.1:9997/v1/health}"
EMBED_MODEL="${LOCAL_EMBEDDING_MODEL:-bge-m3}"

log() { echo "[local-models] $(date +%T) $*"; }

log "starting vllm + xinference"
docker compose -f "$COMPOSE_FILE" up -d

log "waiting for vllm health: $VLLM_HEALTH"
for i in $(seq 1 60); do
  if curl -sf "$VLLM_HEALTH" >/dev/null 2>&1; then log "vllm ready"; break; fi
  sleep 5
  [ "$i" -eq 60 ] && { log "vllm health timeout"; exit 1; }
done

log "waiting for xinference health: $XINF_HEALTH"
for i in $(seq 1 60); do
  if curl -sf "$XINF_HEALTH" >/dev/null 2>&1; then log "xinference ready"; break; fi
  sleep 5
  [ "$i" -eq 60 ] && { log "xinference health timeout"; exit 1; }
done

log "launching embedding model: $EMBED_MODEL"
curl -sf -X POST "http://127.0.0.1:9997/v1/models" \
  -H 'Content-Type: application/json' \
  -d "{\"model_name\":\"${EMBED_MODEL}\",\"model_type\":\"embedding\"}" >/dev/null \
  && log "embedding model launched" \
  || log "embedding model launch skipped (可能已存在，忽略)"

log "done. 在 FastGPT 后台配置: LLM=http://vllm:8000/v1, embedding=http://xinference:9997"
