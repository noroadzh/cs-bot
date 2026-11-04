# Proposal

## Why

`absorb-phase2-into-phase1` 把原二期能力以骨架落地，但差距表 P0 四项（存档入 import、shared 数据面隔离、多模型热路径、计费持久化）未达可验收。代码已接线；需要把验收口径写入规格并归档，避免主规格仍停留在「骨架」表述。

## What Changes

- 收紧会话存档：管理面 ingest MUST 创建真实 `import_job`（非仅内存队列）
- 收紧 shared / 实例 `TENANT_ID`：miss / asset / import / Redis 前缀隔离可验收
- 收紧多模型路由：问答热路径 MUST 经 `ModelRouter` 选路与失败 fallback
- 收紧自助计费：订单 MUST 持久化；mock/sandbox 支付成功 MUST renew + 审计
- **非本 change**：企微存档 SDK 拉取、真实微信/支付宝 SDK、单进程多租户 ALS、GPU/Prometheus

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `import-pipeline`: Session archive realtime ingest — 明确经 import 建任务
- `tenant-registry`: Shared tenancy + Self-serve billing — 数据面隔离与订单持久化
- `local-model-routing`: Multi-model routing — 热路径选路与 fallback

## Impact

- 代码已在 `apps/adapter`（archive / miss / media / import / context / routing / license-gate / qa / platform/billing）
- 迁移：`miss/015`、`media/016`、`import/017`、`platform/021-billing-order`
- 施工单：`.cursor/plan/p0-close-skeletons.md`
- 依赖先归档/sync `absorb-phase2-into-phase1` 的 ADDED，再应用本 change 的 MODIFIED
