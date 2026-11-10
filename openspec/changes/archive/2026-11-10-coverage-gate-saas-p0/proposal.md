# Proposal

## Why

管道模块已有 Jest 覆盖率门禁，但 `platform` / `import` / `usage` 等已交付业务面不在 `collectCoverageFrom` 内，CI 无法兜住开通失败、导入单并发、配额触顶等风险路径。需要把 SaaS/导入关键路径纳入单测契约与门禁，且不追求全目录 80%。

## What Changes

- 扩展 `unit-testing`：`platform`、`import`、`usage` 纳入覆盖率收集，行覆盖率门禁 ≥60%（与现有横切同档）
- 补齐关键 Scenario 的离线单测：导入锁 `IMPORT_BUSY` / 强制释放 / 启动清锁；用量 webhook 失败不抛；开通/指纹/配额已有测的路径在 tasks 中核对并补洞
- **非目标**：官方支付 SDK、GPU catalog、admin knowledge/users 控制器、全量 platform 行覆盖 80%、下调管道阈值

## Capabilities

### Modified Capabilities

- `unit-testing`: 门禁目录与 SaaS/导入/用量必测 Scenario
- `import-job`: 单并发租约与冲突错误码的可验收 Scenario（若主规格已有则只补测）

## Impact

- 代码：`apps/adapter/jest.config.cjs`、`apps/adapter/test/*`
- 规格：`openspec/specs/unit-testing`（及必要时 `import-job`）
- 施工单：`.cursor/plan/coverage-gate-saas-p0.md`
- 写权限：`adapter-foundation`（jest 配置）+ `import-pipeline` / `platform-saas` 相关 spec
