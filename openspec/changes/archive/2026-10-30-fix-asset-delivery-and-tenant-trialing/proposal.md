# Proposal

## Why

素材外发（增项 A）在真实环境中不可用：编排器只把 `{id, type}` 交给发送器，落盘的相对 URL 又被直接当成文件路径，导致 file/video 素材必然上传失败，用户只能看到文字答案；失败时也没有设计要求的降级提示。同时 `tenant.status` 的 CHECK 约束不含 `trialing`，而实体、状态机与规格都把 `trialing` 当作订阅生命周期的一环，写入即 500。

概设/详设本轮核对还发现 18 处表述与实现不一致（素材删除语义、订阅宽限期行为、触发词样例、Cron 归属、接口签名等），需要一次性对齐，避免运维按错误文档操作。

## What Changes

- 修复素材外发链路：编排器传递完整素材信息；file/video 的 `/assets/<id>.<ext>` 映射到 `data/assets/` 实际路径；link 带标题外发。
- 素材发送失败时按概设 M8 补发一次降级提示话术（不止 WARN 日志）。
- 删除素材时同时清理 video 落盘文件（消除磁盘泄漏与容量统计漂移）。
- 新增迁移 `018`：`tenant.status` CHECK 纳入 `trialing`（幂等 drop/add）。
- 规格对齐：`media-management` 的落盘命名、删除范围、外发入参与失败提示按实际语义修正。
- 文档对齐：概设升至 V1.28、详设升至 V1.18（素材删除语义、订阅状态机与宽限期行为、trialing、配额列名映射、选型基线版本、触发词样例、Cron 归属、接口签名、回调响应体、繁忙话术、asset.url 说明、M5 写入方式）；部署手册关联文档版本行同步。
- **BREAKING**: 无（对外接口路径与入参不变；link 外发文本增加标题行属展示优化）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `media-management`: 资产落盘命名由 `data/assets/<id>` 明确为 `data/assets/<id>.<ext>`；删除时 file 与 video 均清理落盘文件；外发时向发送器传递 `url`/`name`，发送失败需向会话补发一次降级提示。

## Impact

- 代码：`apps/adapter/src/qa/qa-orchestrator.ts`、`apps/adapter/src/media/asset-sender.service.ts`、`apps/adapter/src/media/asset.service.ts`、`apps/adapter/src/config/config.schema.ts`、新增 `apps/adapter/src/platform/018-tenant-trialing.sql`
- 测试：`apps/adapter/test/asset-sender.service.spec.ts`、`qa-orchestrator` 素材用例、`asset.service.spec.ts`（video 删除）、迁移引用校验
- 文档：《概要设计 V1.28》《详细设计 V1.18》《部署手册》关联文档行
- 依赖：无新增依赖；无数据库破坏性变更（仅放宽 CHECK）
