# 概设/详设完整性复核（第十五轮，2026-10-30，只读）

## 范围

基准：概设 V1.19、详设 V1.11。本轮核对 **§10.5 SaaS 备份与恢复**、**§9.2 部署手册备份/恢复步骤**。

## 结论

功能主链路无缺口。发现 **1 项承诺未实现（P1）** 与 **2 处文档不准确（P2）**。

## P1 「订阅期内 1 次按需恢复」未实现

- 概设 §10.5：*「每租户每日 02:00 快照（pg_dump + 数据目录）保留 7 天，存独立对象存储路径 `backup/{tenantId}/`；**订阅期内 1 次按需恢复**」*
- 实际：
  - 备份有：`scripts/backup-tenants.sh`（pg_dump + mongodump + data/license tar，保留 7 天，失败隔离）
  - **恢复无**：仓库无租户恢复脚本/接口；`scripts/migrate-import.sh` 是整机迁移恢复，不适用于单租户按需恢复
  - 部署手册 §9.2 的恢复示例只覆盖**私有化** adapter 的 PG，未覆盖 SaaS 租户实例
- 影响：SaaS 租户数据损坏时，运营只能手工拼 `docker compose` 命令，达不到「按需恢复」的 SLA 承诺
- 建议：新增 `scripts/restore-tenant.sh <tenantId> [--date ...] [--yes] [--dry-run]`：定位备份 → 停租户 compose → psql/mongorestore/解包 data+license → 启动；文档补步骤与「每次订阅期 1 次」的运营口径

## P2 文档不准确

1. **备份路径**：概设写 `backup/{tenantId}/`；实际 `scripts/backup-tenants.sh` 写到 `backup/tenants/{id}/<YYYYmmdd_HHMMSS>/`。
2. **部署手册 §9.2**：写「备份包含…与租户实例」，但未给出 `scripts/backup-tenants.sh` 的 cron 配置与产物路径，也没写租户恢复步骤——运维无法照做。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 私有化每日备份 | `deploy/backup.sh`（pg×3 + mongo + assets，保留 7 天）+ 手册恢复步骤 |
| 备份失败隔离 | 单租户失败不影响其它租户，退出码非零 |
| 升级前快照 | `scripts/tenant-upgrade.sh` + orchestrator 快照/回滚 |
| 导出包 | 注销导出含 pg/mongo/assets/配置 |
