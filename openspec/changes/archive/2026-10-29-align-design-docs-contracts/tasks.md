# Tasks

## 1. 详细设计对齐

- [x] 1.1 §6.2 素材接口：入参/返回/删除语义改为实际契约。
- [x] 1.2 §6.3 导入接口：路径 `/admin/import-jobs`、confirm `{decisions}`、补实际端点。
- [x] 1.3 §5 Redis 键表：`rate:*`、`rate:hint`、文件缓冲；删除 `license:cache`/`import:queue`。
- [x] 1.4 §4 DDL：去掉 `adapter` schema 前缀与 `keyword_trigger`，注明关键词文件来源。
- [x] 1.5 §3.10 用量上报：补 `docCount/qaCount/assetMb`。
- [x] 1.6 概要设计：导入路径统一、关键词改配置口径（删除 `keyword_trigger` 表）。

## 2. 部署手册对齐

- [x] 2.1 修正导入路径示例（`/admin/import-jobs/:id`）。
- [x] 2.2 详设与手册版本记录补 V1.2。

## 3. 验证

- [x] 3.1 全文检索无旧路径 `/admin/import/jobs`、无 `keyword_trigger` 残留。
- [x] 3.2 `openspec validate` 通过；确认无代码/规格改动。

## Workflow follow-up

- 完成后 `/opsx:verify align-design-docs-contracts`，通过后 `/opsx:archive`。
