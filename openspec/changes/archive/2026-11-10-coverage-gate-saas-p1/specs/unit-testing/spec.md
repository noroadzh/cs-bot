## MODIFIED Requirements

### Requirement: 覆盖率门禁

`apps/adapter/jest.config.cjs` MUST 设置路径级 `coverageThreshold`：管道模块行/语句/函数 ≥80%、分支 ≥70%；横切模块 ≥60%（admin/health 分支棘轮见配置）。全局行/语句 ≥75%、分支 ≥60%、函数 ≥70% MUST 由 `apps/adapter/scripts/check-coverage-global.mjs` 依据 `coverage-summary.json` 的 `total` 校验。另 MUST 将下列文件纳入 `collectCoverageFrom` 并满足单文件阈值：

- **P0**：`tenant-quota.service`、`tenant.service`、`shell-provisioner`、`import-lock`、`capacity-guard`、`usage-webhook.service`（行/语句/函数见既有棘轮）
- **P1**：`fastgpt-qa.engine.ts`、`import-job.service.ts`、`platform.controller.ts` —— 各自行/语句/函数 ≥60%，分支 ≥50%

禁止再下调上述棘轮；扩面时优先补测而非降阈值。

#### Scenario: 覆盖率不足阻断
- **WHEN** 临时删除一个核心断言使某管道模块行覆盖降至 70% 后执行 `pnpm -C apps/adapter test:cov`
- **THEN** 命令以非 0 退出码结束（jest 路径阈值或全局摘要脚本报失败）

#### Scenario: SaaS 与导入关键路径纳入门禁
- **WHEN** 执行 `pnpm -C apps/adapter test:cov`
- **THEN** 覆盖率报告包含 P0 与 P1 关键路径文件
- **AND** 这些文件与全局/管道/横切阈值均满足，否则退出码非 0

#### Scenario: P1 三文件纳入门禁
- **WHEN** 执行 `pnpm -C apps/adapter test:cov`
- **THEN** 报告包含 `fastgpt-qa.engine.ts`、`import-job.service.ts`、`platform.controller.ts`
- **AND** 各自满足行/语句/函数 ≥60%、分支 ≥50%，否则退出码非 0
