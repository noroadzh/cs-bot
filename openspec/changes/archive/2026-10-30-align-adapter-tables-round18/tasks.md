# Tasks

- [x] 1.1 §7.1 五张业务表按迁移重写（字段/索引/状态值），注明以迁移为准。
- [x] 1.2 §7.2 Redis 键表改为 `rate:*`/`rate:hint`/`wecom:at`。
- [x] 1.3 版本与引用同步（概设 V1.23）。
- [x] 2.1 检索确认无 `ratelimit:`、`wecom:access_token`、`asset_type` 残留（版本记录除外）；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify align-adapter-tables-round18`，通过后 `/opsx:archive`。
