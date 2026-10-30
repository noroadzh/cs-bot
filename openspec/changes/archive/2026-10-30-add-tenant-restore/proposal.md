# Proposal

## Why

第十五轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-15.md`）发现：概设 §10.5 承诺「订阅期内 1 次按需恢复」，且已有 `scripts/backup-tenants.sh` 每日备份，但仓库没有任何租户恢复脚本/接口；手册 §9.2 的恢复步骤只覆盖私有化 adapter。租户数据损坏时运营只能手工拼 docker 命令。

## What Changes

- 新增 `scripts/restore-tenant.sh`：
  - 用法 `restore-tenant.sh <tenantId> [--date YYYYmmdd_HHMMSS] [--backup-dir DIR] [--yes] [--dry-run]`
  - 默认取该租户最新备份；校验 compose 与备份文件存在
  - `--dry-run` 打印将执行的步骤（不改变任何状态）
  - `--yes` 执行：停租户 compose → 重建 public schema 后恢复 pg_dump → `mongorestore --drop` → 解包 data/license → 启动并等待 healthy
- 文档：部署手册 §9.2 补 `backup-tenants.sh` 的 cron、产物路径与租户恢复步骤；概设 §10.5 备份路径改为 `backup/tenants/{tenantId}/`，并注明恢复脚本。
- 测试：`restore-tenant.spec.ts`（缺参/未知租户/最新备份选择/dry-run 输出）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：新增「租户按需恢复」要求。

## Impact

- **脚本**：`scripts/restore-tenant.sh`（新）。
- **测试**：`apps/adapter/test/restore-tenant.spec.ts`（新）。
- **文档**：部署手册 §9.2、概设 §10.5。
- **代码/规格行为**：无运行时改动；恢复为运维手动操作，需 `--yes` 二次确认。
