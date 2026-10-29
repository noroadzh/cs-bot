# Tasks

## 1. 统一 FastGPT 客户端

- [x] 1.1 新增 `qa/fastgpt.client.ts`（chat/ensureDataset/writeBatch/deleteDataset/searchTest/collectionCount，统一凭据/超时/错误映射）。
- [x] 1.2 `fastgpt-qa.engine`、`fastgpt-dataset.client`、`near-duplicate`、`capacity-usage.service` 改为经该客户端调用（保留可注入 fake）。
- [x] 1.3 三个模块装配同一客户端；新增 `fastgpt-client.spec.ts`。

## 2. LLM 双通道失败告警

- [x] 2.1 新增 `qa/llm-alert.service.ts`（滑动窗口 + 冷却 + OPS webhook，失败只 WARN）。
- [x] 2.2 `QaOrchestrator` 失败分支调用 `recordFailure`，成功清零；新增配置 `LLM_ALERT_THRESHOLD/WINDOW_MS/COOLDOWN_MS`。
- [x] 2.3 新增 `llm-alert.spec.ts`（阈值一次、冷却、成功清零、webhook 缺失/失败容错）。

## 3. 文档

- [x] 3.1 概设 §11.2/§11.4/ADR A6 自愈描述改为容器 restart + 宿主 docker 自启；R-3 表述收敛。
- [x] 3.2 详设 §2.1/§2.3 更新为统一 FastGPTClient。
- [x] 3.3 部署手册补告警配置与自愈说明；`.env.template` 增告警参数。

## 4. 验证

- [x] 4.1 全量单测、集成、验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify consolidate-fastgpt-client`，通过后 `/opsx:archive`。
