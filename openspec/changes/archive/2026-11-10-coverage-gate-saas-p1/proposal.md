# Proposal

## Why

P0 门禁已绿，但仍排除 `fastgpt-qa.engine`、`import-job.service`、`platform.controller` 三块关键面。需要把它们拉回 `collectCoverageFrom` 并设单文件阈值，避免回归时再次静默掉出安全网。

## What Changes

- 扩展 `unit-testing`：上述三文件 MUST 纳入覆盖率收集，单文件行/语句/函数 ≥60%，分支 ≥50%（引擎/控制器分支面大，棘轮不低于此）
- 补关键分支 Scenario 的离线单测；不改生产行为
- **非目标**：整目录 `platform/**` 80%、`model-router`、admin knowledge、支付 SDK、GPU

## Capabilities

### Modified Capabilities

- `unit-testing`: P1 关键路径文件纳入门禁

## Impact

- `apps/adapter/jest.config.cjs`、相关 `test/*.spec.ts`
- `openspec/specs/unit-testing`
- `.cursor/plan/coverage-gate-saas-p1.md`
