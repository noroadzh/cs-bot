# P0 骨架收口

- **OpenSpec**: `openspec/changes/p0-close-skeletons/`（归档后见 `openspec/changes/archive/2026-11-03-p0-close-skeletons/`）
- **前置 sync**: `absorb-phase2-into-phase1` ADDED 已并入主规格
- **对照**: `.cursor/plan/design-gap-matrix.md` §5 P0
- **主规格**: `import-pipeline` / `tenant-registry` / `local-model-routing`

## 范围（已完成）

1. **存档→import**：`ArchiveService.enqueue` → `ImportJobService.createFromFile`（JSON wecom-archive）
2. **shared 隔离**：`tenant_id` 列 + `TENANT_ID` 读写过滤；Redis `t:{id}:` 前缀
3. **多模型路由**：`ModelRouterService` 注入 `FastGPTQaEngine`，primary 失败 `pickFallback`
4. **计费持久化**：`platform/021-billing-order.sql` + `BillingService` 走 PG；mock 支付仍走 `/self-serve/orders/:id/pay`

## 非目标

- 真实企微存档 SDK / 微信支付宝 SDK
- 单进程多租户 ALS 路由（仍按实例 `TENANT_ID`）
- GPU/Prometheus/通配 TLS

## 验收

- [x] 存档 ingest 返回真实 `import_job.id`
- [x] 两租户 miss/asset/import/redis key 互不可见（单测）
- [x] 路由目录有次选时 primary 失败重试 secondary
- [x] 订单落库；`markPaid` → renew + audit
- [x] openspec 产物齐全并 sync 主规格后归档
