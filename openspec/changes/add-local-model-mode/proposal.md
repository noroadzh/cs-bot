# Proposal: add-local-model-mode

## Why

增项 D（本地模型部署与切换）目前在部署手册附录 D 中有配置项说明（`MODEL_MODE`、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`），但代码层完全未实现（`config.schema.ts` 无这些字段、无本地优先/降级路由逻辑）。对数据不出域要求的客户，当前无法真正以本地模型运行。

## What Changes

- **新增配置**：`MODEL_MODE`（`cloud` / `hybrid` / `local`）、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`、`LOCAL_LLM_MODEL`，进 `config.schema.ts` fail-fast 校验。
- **hybrid 路由**：本地推理优先，超时/故障自动切云端；记录切云次数与原因。
- **local 模式**：全本地，故障直接回繁忙话术、不出域（不出站 LLM）；出站白名单可仅保留企微域名。
- **问答编排降级**：`QaOrchestrator`/FastGPT 调用链按 `MODEL_MODE` 选择端点与降级策略；embedding 切换需全量重建向量索引（运行手册说明）。
- **部署配套**：`local-models-compose.yml`（vllm + xinference）、模型拉取与健康检查脚本。

## Capabilities

### New Capabilities
- `local-model-routing`: 模型通道选择（cloud/hybrid/local）、本地优先与故障降级、出站白名单。

### Modified Capabilities
- `qa-orchestration`: 按 MODEL_MODE 选择 LLM 通道与降级路径。
- `deployment-suite`: 本地模型 compose/模型拉取/健康检查与运行手册。

## Impact

- **代码**：`apps/adapter/src/config/config.schema.ts`；`apps/adapter/src/qa/` 或新 `model-routing/`；`apps/adapter/src/usage/`（切云计数）。
- **配置**：`MODEL_MODE`、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`、`LOCAL_LLM_MODEL`。
- **部署**：`deploy/local-models-compose.yml`、模型拉取脚本。
- **依赖**：vllm / xinference（GPU 或 CPU 兜底），不在 npm 依赖内。
- **风险**：embedding 向量空间不兼容 → 切换必须全量重建索引；本地时延 P95 ≤ 15s 属预期取舍。

## 备注

- 概设 §4.3、详设 §3.4/部署手册附录 D；总纲见 `close-overview-design-gaps`。
- 本 change 只做增项 D，不含 M10/M11/验收测试。
