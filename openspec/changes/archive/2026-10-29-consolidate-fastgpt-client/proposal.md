# Proposal

## Why

第六轮复核（`openspec/explorations/2026-10-29-design-completeness-recheck-6.md`）发现三处架构约束与降级承诺未落地：R-2「单一 FastGPT 客户端」实际有 4 处独立访问（鉴权/超时/重试分散）；概设 §11.2「双通道挂 → 繁忙话术 + 告警」只有话术没有告警；「适配层挂 → systemd 重启」与容器化交付实际形态不符。另有 R-3 表述需澄清。

## What Changes

- **统一 FastGPT 访问**：新增 `apps/adapter/src/qa/fastgpt.client.ts`，集中 `chat` / `dataset` / `searchTest` / `collectionCount` 四类调用与统一凭据、超时、重试；`fastgpt-qa.engine`、`fastgpt-dataset.client`、`near-duplicate`、`capacity-usage.service` 改为注入该客户端（保留各自可注入 fake 用于测试）。
- **LLM 双通道失败告警**：新增 `LlmAlertService`，复用 `OPS_WEBHOOK_URL`，连续失败达阈值（默认 5 分钟内 ≥3 次）推送一次并节流（默认 30 分钟）；告警失败只 WARN，不影响问答。
- **适配层自愈表述修订**：概设 §11.2/§11.4/ADR A6 与部署手册改为「容器 `restart: unless-stopped` 自愈 + 宿主 `systemctl enable docker`」，删除 systemd 单元承诺。
- **R-3 表述收敛**：明确「含动态内容的出站文本必须过 M6；系统内置固定话术与管理员配置的素材标题除外」并给出理由。
- `qa-orchestration` 规格新增「LLM 失败告警」要求；`deployment-suite` 无变化。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `qa-orchestration`：新增 LLM 双通道失败告警要求（话术 + 告警 + 节流）。

## Impact

- **代码**：新增 `qa/fastgpt.client.ts`、`qa/llm-alert.service.ts`；改造 4 处调用方与 `qa.module`/`import.module`/`usage.module` 装配。
- **配置**：`LLM_ALERT_THRESHOLD`（默认 3）、`LLM_ALERT_WINDOW_MS`（默认 300000）、`LLM_ALERT_COOLDOWN_MS`（默认 1800000）。
- **测试**：新增 `fastgpt-client.spec.ts`、`llm-alert.spec.ts`；既有 4 个调用方测试改为注入 fake 客户端。
- **文档**：概设 §3.4/§11.2/§11.4/ADR A6、详设 §2.1/§2.3、部署手册、`.env.template`。
