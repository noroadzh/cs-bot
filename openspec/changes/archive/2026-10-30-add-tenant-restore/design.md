# Design

## Context

见 proposal.md。`scripts/backup-tenants.sh` 产物布局：`${BACKUP_DIR:-<root>/backup}/tenants/<tenantId>/<YYYYmmdd_HHMMSS>/{pg_*.sql.gz,mongo_*.archive.gz,data_*.tar.gz}`；租户 compose 在 `${PLATFORM_COMPOSE_DIR}/<tenantId>/docker-compose.yml`，项目名 `csbot-t-<id>`。

## Goals / Non-Goals

**Goals:**

- 一条命令把单个租户恢复到指定/最新备份。
- 默认只打印计划；必须显式 `--yes` 才动容器与数据。

**Non-Goals:**

- 不做跨租户/整机恢复（用 `scripts/migrate-import.sh`）。
- 不做异地对象存储拉取（备份路径由 `BACKUP_DIR` 指定）。
- 不记录恢复次数（「每次订阅期 1 次」由运营台账管理）。

## Decisions

### D1 参数与解析

```
./scripts/restore-tenant.sh <tenantId> [--date YYYYmmdd_HHMMSS] [--backup-dir DIR] [--yes] [--dry-run]
```

- `<tenantId>` 必填；缺参打印用法并退出 2。
- `--date` 省略时取该租户备份目录下时间戳最大的一个。
- `--backup-dir` 覆盖 `BACKUP_DIR`（默认 `<repo>/backup`，实际读 `.../tenants/<id>/<date>`）。

### D2 校验顺序（fail fast）

1. 租户 compose 存在；2. 备份目录存在；3. `pg_*.sql.gz` 与 `mongo_*.archive.gz` 必须存在；`data_*.tar.gz` 可选（无则提示跳过）。

### D3 执行步骤（仅 `--yes`）

```
docker compose -p csbot-t-<id> -f <compose> stop
exec psql -d csbot -c 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'
gunzip -c pg_*.sql.gz | exec psql -d csbot -v ON_ERROR_STOP=1
exec mongorestore --archive --gzip --drop < mongo_*.archive.gz
tar -xzf data_*.tar.gz -C <tenantDir>          # 内含 data/ 与 license/
docker compose ... up -d
docker compose ... ps
```

- `--dry-run` 打印以上命令但不执行；未带 `--yes` 同样打印计划并退出 3，提示「确认后加 --yes」。
- 任一步失败即 `exit 1`，不继续后续步骤（避免半恢复状态）。

### D4 文档

- 部署手册 §9.2：补 SaaS 租户备份 cron（`scripts/backup-tenants.sh`，每日 02:00）、产物路径、恢复命令与注意事项。
- 概设 §10.5：备份路径改为 `backup/tenants/{tenantId}/`；注明恢复脚本与 `--yes` 二次确认。

## Risks / Trade-offs

- [恢复覆盖现有数据] → 强制 `--yes`；PG 先 DROP public schema，mongo 用 `--drop`，语义明确。
- [租户 compose 未启动] → `stop` 对已停止服务是无害 no-op；恢复后 `up -d`。
- [备份文件不完整] → 恢复前校验必需文件，缺则拒绝。

## Migration Plan

- 纯新增脚本，无迁移；回滚删除脚本即可。

## Verification

- `restore-tenant.spec.ts`：缺参/未知租户/无备份 → 非零；有备份 `--dry-run` → 计划含 psql/mongorestore 且不执行 docker；无 `--yes` → 非零且提示。
- `bash -n`；全量单测/集成/验收通过。
