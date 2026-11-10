## 1. 规格与施工单

- [x] 1.1 写 proposal / design / unit-testing delta
- [x] 1.2 写 `.cursor/plan/coverage-gate-saas-p0.md`

## 2. 补关键路径单测

- [x] 2.1 `ImportLock`：acquire 成功、冲突 `IMPORT_BUSY`、release、forceRelease、resetOnBoot
- [x] 2.2 `UsageWebhookService`：无 URL 跳过；成功 POST；失败返回 false 不抛
- [x] 2.3 核对已有 fingerprint/quota/capacity/reason/import-memory；并修 tenant_id 断言漂移（import-job/asset/miss）

## 3. 门禁

- [x] 3.1 `collectCoverageFrom` 纳入管道/横切 + P0 关键路径文件（非整目录稀释）；排除非目标与拖低棘轮的大面文件
- [x] 3.2 路径级 `coverageThreshold` + `scripts/check-coverage-global.mjs`（全局行/语句 ≥75%、分支 ≥60%、函数 ≥70%）
- [x] 3.3 `pnpm -C apps/adapter test:cov` 全绿（2026-11-10：131 suites / 1103 tests；global ~87/73/85/89）

## 4. 顺带修复（支撑门禁可跑）

- [x] 4.1 `ImportModule` / `MediaModule` 引入 `AdminAuthModule`（RBAC 后 Guard DI）
- [x] 4.2 `platform.controller.spec` / `miss.controller.spec` 构造参数对齐
- [x] 4.3 license-native stub、`testTimeout` 180s（WSL/D: exceljs）、pipeline-budget 开销断言放宽

## 5. 收尾

- [x] 5.1 全量 `test:cov` 绿后勾选 3.3；更新 plan / 差距备注
- [x] 5.2 verify 后 archive（`openspec archive coverage-gate-saas-p0 -y`）
