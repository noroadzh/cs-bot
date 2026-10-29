# Proposal

## Why

第三轮完整性复核（`openspec/explorations/2026-10-29-design-completeness-recheck-3.md`）发现：功能已全部实现且与主规格一致，但详细设计 V1.1 仍保留早期口径——导入接口路径、confirm 入参、素材接口字段、Redis 键表、DDL schema 与关键词表、用量上报字段均与实现不符。详设声明“接口契约冻结、二期原样复用”，继续保留会让二期与排障按错误契约开发。

## What Changes

- 详设 §6.2 素材接口：入参改为 `file` 或 `{url,name}`，返回改为 `{success, asset}`；DELETE 改为删除记录与落盘文件。
- 详设 §6.3 导入接口：路径改为 `/admin/import-jobs`，confirm 入参改为 `{decisions:[{itemId, reviewStatus}]}`，补齐 from-url、parse、items、approve-all、unpaired 等实际端点。
- 详设 §5 Redis 键表：限流改为 `rate:group/rate:user（按分钟）` + `rate:hint`；删除未使用的 `license:cache`、`import:queue`；上报缓冲标注为文件 `data/report-buffer.json`。
- 详设 §4 DDL：去掉未使用的 `adapter` schema 前缀与 `keyword_trigger` 表，注明关键词来自 `config/keywords.yml`；同步去掉 `asset.enabled` 等未实现列描述。
- 详设 §3.10 用量上报：body 补 `docCount/qaCount/assetMb`。
- 概要设计：导入接口路径统一为 `/admin/import-jobs`；关键词改为 `config/keywords.yml` 配置口径（删除 `keyword_trigger` 表）；版本记录补 V1.10。
- 部署手册：修正第 432 行导入路径；版本记录补 V1.2。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档对齐，行为与主规格不变，`skip_specs: true`。）

## Impact

- **文档**：`docs/02-需求与设计/概要设计-微信群智能客服机器人MVP.md`、`docs/02-需求与设计/详细设计-微信群智能客服机器人MVP.md`、`docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md`。
- **代码/规格/测试**：无改动。
