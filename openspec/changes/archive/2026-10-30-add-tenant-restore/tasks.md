# Tasks

- [x] 1.1 新增 `scripts/restore-tenant.sh`（参数解析、最新备份选择、fail-fast 校验）。
- [x] 1.2 `--dry-run` 打印计划；无 `--yes` 拒绝执行；`--yes` 按 stop→pg→mongo→data→up 恢复。
- [x] 2.1 新增 `restore-tenant.spec.ts` 覆盖缺参/未知租户/无备份/dry-run/未确认。
- [x] 3.1 部署手册 §9.2 补租户备份 cron、产物路径与恢复步骤；概设 §10.5 路径与脚本说明。
- [x] 4.1 全量单测/集成/验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify add-tenant-restore`，通过后 `/opsx:archive`。
