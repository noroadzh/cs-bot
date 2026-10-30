# 概设/详设完整性复核（第十八轮，2026-10-30，只读）

## 范围

基准：概设 V1.22、详设 V1.13。本轮核对 **概设 §7.1 适配层业务表** 与 **§7.2 Redis 键设计**（第七轮只修了 §7.4 平台侧表）。

## 结论

功能无缺口；发现 **概设 §7.1/§7.2 两节与实现严重不符（P2 文档）**。

## P2 概设 §7.1 适配层业务表过时

| 表 | 文档 | 实际迁移 |
|---|---|---|
| `miss_record` | `id bigserial`、`chatid`/`userid`、无 `trace_id`/`engine`；索引 `(status, created_at)` | `id bigserial`、`trace_id`、`chat_id`、`user_id`、`score decimal(5,4)`、`engine`（009 增 `media_type`/`status`）；索引 `(created_at DESC)` |
| `asset` | `id serial`、`asset_type`/`title`/`file_path`/`enabled` | `id UUID`、`type`（file/link/video）、`name`、`url`、`size`、`md5`（010）、`created_at`；无 title/file_path/enabled |
| `import_job` | `id bigserial` + 十余个计数字段 + `file_name`/`dataset_name` | `id UUID`、`name`、`source_filename`、`source_hash`、`status`、`item_count`、`parse_error`、`dataset_id`（016）；计数在 `import_item`/服务层聚合 |
| `import_item` | 文档未单列 | `id UUID`、`job_id`、`question`、`answer_raw`、`answer_redacted`、`sensitive_flags JSONB`、`review_status`、`reviewer_note`、`reviewed_at` 等 |
| `approved_qa` | 文档未列 | `id UUID`、`question UNIQUE`、`answer`、`source_job_id`、`source_item_id` |

（另：文档表中 `title` 标注“外发前经 M6 过滤”，与 R-3 修订后的口径也不一致。）

## P2 概设 §7.2 Redis 键过时

| 文档 | 实际 |
|---|---|
| `ratelimit:{chatid}` / `ratelimit:{chatid}:{userid}` | `rate:group:{chatId}:{minute}` / `rate:user:{chatId}:{userId}:{minute}`（按分钟固定窗口） |
| —— | 缺 `rate:hint:{chatId}`（300s，群提示去重） |
| `wecom:access_token` | `wecom:at` + `wecom:at:lock`（刷新锁） |
| `dedup:{msgid}` 48h、`ctx:*` 600s | 一致 |

## 已确认无问题

§7.3 FastGPT 侧数据说明（Mongo 归 FastGPT 独占、适配层不直连）；§7.4 平台侧表（上一轮已重写）；详设 §4 DDL 已标注“以迁移为准”。
