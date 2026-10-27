# Design: add-local-model-mode

## Context

部署手册附录 D 已描述 `MODEL_MODE` 等配置，但代码层未实现（`config.schema.ts` 无该字段，`qa/` 无本地路由）。本 change 落地云/混合/本地三档模型通道与降级。

## Goals / Non-Goals

**Goals:**
- `cloud` / `hybrid` / `local` 三档可配置，行为确定。
- local 档严格不出站云 LLM（数据不出域）。
- embedding 切换有明确重建索引口径。

**Non-Goals:**
- 不做本地模型训练/微调。
- 不做 GPU 调度编排（由 vllm/xinference 负责）。

## Decisions

### D1: 配置
`MODEL_MODE: 'cloud'|'hybrid'|'local'`（默认 cloud）、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`、`LOCAL_LLM_MODEL`；local/hybrid 时 fail-fast 校验本地端点非空。

### D2: 路由与降级
新增 `ModelRouter`（或扩 `QaOrchestrator`）：cloud→现有云通道；local→本地通道；hybrid→本地优先，超时/5xx 切云。降级记录切云次数/原因（usage 计数 + 日志）。

### D3: local 不出站
local 档失败直接回繁忙话术，绝不发起云 LLM 请求；出站白名单可仅保留企微域名。

### D4: embedding 切换
embedding 云/本地向量空间不兼容；切换必须全量重建索引。代码侧不自动切换 embedding，运行手册强制说明。

### D5: 部署配套
`deploy/local-models-compose.yml`（vllm + xinference）、模型拉取与健康检查脚本；`MODEL_MODE` 进 `.env` 模板。

## Risks / Trade-offs

- [R1 本地时延] → P95 ≤ 15s 属预期；LLM_TIMEOUT_MS 调 20–30s。
- [R2 向量空间不兼容] → 强制重建索引，运维文档前置。
- [R3 故障切换抖动] → 熔断/冷却窗口，避免频繁切云。
- [R4 半开状态] → hybrid 下本地部分可用时按请求粒度切换。

## Migration Plan

1. 配置先行（默认 cloud，不改变现有行为）。
2. 上线 `ModelRouter`，灰度高为 cloud→hybrid→local。
3. 本地模型 compose 独立 profile，按需启用。
4. 回滚：`MODEL_MODE=cloud` 即恢复纯云。
