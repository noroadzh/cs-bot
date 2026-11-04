## 1. 规格与施工单

- [x] 1.1 写 proposal / design / delta specs（本 change）
- [x] 1.2 更新 `.cursor/plan/p0-close-skeletons.md` 与 openspec 互链

## 2. 实现（已完成，回填勾选）

- [x] 2.1 存档 ingest → `ImportJobService.createFromFile`
- [x] 2.2 miss/asset/import `tenant_id` + Redis `t:{id}:` 前缀
- [x] 2.3 `ModelRouterService` 接入 `FastGPTQaEngine`
- [x] 2.4 `billing_order` 持久化 + mock pay → renew + audit
- [x] 2.5 单测：billing-shared / tenant-scope / model-router

## 3. 归档

- [x] 3.1 sync absorb-phase2 ADDED → 主规格（归档前置）
- [x] 3.2 sync 本 change MODIFIED → 主规格
- [x] 3.3 archive absorb-phase2-into-phase1 与 p0-close-skeletons
