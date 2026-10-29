# Design

## Context

见 proposal.md。当前 FastGPT 访问分布在 `qa/fastgpt-qa.engine.ts`（chat 主/备）、`import/fastgpt-dataset.client.ts`（数据集写）、`import/near-duplicate.ts`（searchTest）、`usage/capacity-usage.service.ts`（collection list，直接拼 URL）；LLM 双通道失败仅回话术并计数；概设自愈描述用 systemd。

## Goals / Non-Goals

**Goals:**

- 单一 FastGPT 凭据、超时、重试与错误映射入口（R-2）。
- 双通道失败有可观测的运维告警且节流。
- 文档与容器化交付实际形态一致。

**Non-Goals:**

- 不改 FastGPT 侧配置与知识库结构。
- 不引入 outbox/重试队列，告警为旁路 best-effort。
- 不改变现有业务语义与对外响应。

## Decisions

### D1 `FastGPTClient` 形态

`apps/adapter/src/qa/fastgpt.client.ts`：

```ts
class FastGPTClient {
  constructor(cfg: { baseUrl; apiKey; datasetIds; timeoutMs })
  chat(body): Promise<{ answer; quotes; score }>        // /api/v1/chat/completions
  ensureDataset(name): Promise<string>
  writeBatch(datasetId, pairs): Promise<string[]>
  deleteDataset(name | id): Promise<void>
  searchTest(question, datasetIds, limit): Promise<Hit[]>
  collectionCount(datasetId): Promise<number>            // 解析 total
}
```

- 内部一个 `axios.create`（`baseURL` 去尾斜杠、`Authorization`、`timeout`），重试策略按方法参数传入（仅幂等：searchTest/collectionCount 重试 1 次；write 由调用方退避 3 次）。
- 现有 `DatasetClient` / `HybridSearchClient` 接口保留，改为委托 `FastGPTClient`，避免破坏既有测试注入点。

### D2 装配

- `QaModule`、`ImportModule`、`UsageModule` 各自 provider 里构造同一个 `FastGPTClient`（配置来自 `ConfigService`）；`CapacityUsageService` 构造参数新增可选 `fastgpt`，未注入时按原路径构造（保持单测兼容）。

### D3 LLM 告警

新增 `apps/adapter/src/qa/llm-alert.service.ts`：

- `recordFailure(reason)`：滑动窗口计数（默认 `LLM_ALERT_WINDOW_MS=300000`）达 `LLM_ALERT_THRESHOLD=3` 且距上次告警超过 `LLM_ALERT_COOLDOWN_MS=1800000` → 推送 `[cs-bot] LLM 双通道连续失败 N 次（last: <errCode>）`。
- 复用 `OPS_WEBHOOK_URL`（企微群机器人 text 消息）；未配置 = 关闭；发送失败只 WARN。
- `QaOrchestrator` 在 `!result.ok` 分支调用 `recordFailure`，并在成功后 `recordSuccess()` 清零窗口。

### D4 文档

- 概设 §11.2 降级矩阵：`适配层挂 → 容器 restart: unless-stopped 自愈 + 宿主 systemctl enable docker（RTO < 1min）`；§11.4 与 ADR A6 同步。
- 概设 §3.4 R-3 改为「含动态内容的出站文本必须过 M6；系统内置固定话术（授权/租户闸门、多媒体引导）与管理员配置的素材标题除外——前者不含用户输入，后者非群消息来源」。
- 详设 §2.1 增补 FastGPTClient 行；§2.3 改为「M4/M10/用量统计统一经 FastGPTClient」。
- 部署手册补告警配置项与自愈说明；`.env.template` 增三个告警参数。

## Risks / Trade-offs

- [统一客户端成为单点] → 仅进程内封装，无额外网络跳；失败语义与现状一致。
- [告警风暴] → 滑动窗口 + 冷却期双闸门。
- [测试改造面] → 保留既有接口，fake 注入不变；新增客户端单测覆盖路径拼接与错误映射。

## Migration Plan

1. 一次性发布；无数据库/配置破坏性变更，新参数均有默认值。
2. 回滚：恢复上一镜像；行为回退到仅计数。

## Verification

- `fastgpt-client.spec.ts`：URL 拼接（尾斜杠）、鉴权头、超时透传、错误映射、collectionCount 解析。
- `llm-alert.spec.ts`：阈值触发一次、冷却期内不重复、成功后清零、webhook 未配置/失败不影响调用方。
- 既有 4 处调用方测试改为注入 fake 客户端并保持断言。
- 全量单测、集成、验收通过。
