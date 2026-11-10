## MODIFIED Requirements

### Requirement: 覆盖率门禁

`apps/adapter/jest.config.cjs` MUST 设置路径级 `coverageThreshold`：管道模块行/语句/函数 ≥80%、分支 ≥70%；横切模块 ≥60%（admin/health 分支棘轮见配置）。全局行/语句 ≥75%、分支 ≥60%、函数 ≥70% MUST 由 `apps/adapter/scripts/check-coverage-global.mjs` 依据 `coverage-summary.json` 的 `total` 校验（避免 Jest 在「global + 路径阈值」并存时算偏）。另 MUST 将 SaaS/导入/用量 **P0 关键路径文件**（至少含 `tenant-quota.service`、`tenant.service`、`shell-provisioner`、`import-lock`、`capacity-guard`、`usage-webhook.service`）纳入 `collectCoverageFrom`，且这些文件覆盖率 MUST 满足配置中的单文件阈值。禁止再下调上述棘轮；扩面时优先补测而非降阈值。

#### Scenario: 覆盖率不足阻断
- **WHEN** 临时删除一个核心断言使某管道模块行覆盖降至 70% 后执行 `pnpm -C apps/adapter test:cov`
- **THEN** 命令以非 0 退出码结束（jest 路径阈值或全局摘要脚本报失败）

#### Scenario: SaaS 与导入关键路径纳入门禁
- **WHEN** 执行 `pnpm -C apps/adapter test:cov`
- **THEN** 覆盖率报告包含上述 P0 关键路径文件
- **AND** 这些文件与全局/管道/横切阈值均满足，否则退出码非 0

## ADDED Requirements

### Requirement: SaaS 与导入关键路径单测

除管道与横切既有要求外，下列行为 MUST 各有离线单测（stub pg/axios，不连真实外部 IO）：

#### Scenario: ImportLock 单并发冲突
- **WHEN** 执行 `test/import-lock.spec.ts`（或等价）
- **THEN** 覆盖：acquire 成功持有锁、第二把锁抛 `IMPORT_BUSY`（HTTP 409）、release 后可再 acquire、forceRelease 与 resetOnBoot 清锁

#### Scenario: Usage webhook 失败不抛
- **WHEN** 执行 usage webhook 相关 spec
- **THEN** 覆盖：未配置 URL 时 report 返回 false 且不请求网络；POST 成功返回 true；POST 失败返回 false 且不向调用方抛异常

#### Scenario: 配额与指纹路径保持可回归
- **WHEN** 执行既有 `tenant-quota` / `capacity-guard` / `tenant-fingerprint-rebind` / `platform-reason-guard` spec
- **THEN** 仍通过；本 change 不得删除或削弱这些断言
