# Proposal

## Why

第十八轮复核发现概设 §7.1 适配层业务表与 §7.2 Redis 键设计仍停留在早期版本：`miss_record` 缺 `trace_id`/`engine`、`asset` 用 `asset_type/title/file_path/enabled`、`import_job` 用 `file_name/file_hash/source_type`、Redis 键写成 `ratelimit:*` 与 `wecom:access_token`。与迁移和实现严重不符，排障/二期对接会查错列名与键名。

## What Changes

- **§7.1 按迁移重写**：`miss_record`、`asset`、`import_job`、`import_item`、`approved_qa` 五张表的实际字段与索引，注明「以 `apps/adapter/src/**/NNN-*.sql` 为准」。
- **§7.2 按实现重写**：`dedup:{msgid}`(48h)、`ctx:{chatId}:{userId}`(600s)、`rate:group/rate:user:{minute}`(60s)、`rate:hint:{chatId}`(300s)、`wecom:at` + `wecom:at:lock`。
- 版本：概设 V1.23。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：概设 §7.1/§7.2、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
