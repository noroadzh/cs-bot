# Tasks

## 1. 素材外发链路

- [x] 1.1 `IMessageSender.sendAsset` 增加可选 `title` 参数；`WecomClient.sendAsset` 对 link 发送 `标题\nURL`，file/video 透传 title
- [x] 1.2 `AssetSenderService.send` 解析 `/assets/<id>.<ext>` 为 `data/assets/` 绝对路径，返回 `boolean`，仍只记 WARN 不抛
- [x] 1.3 `QaOrchestrator` 传递 `{ id, type, name, url }`，收集失败并在循环结束后补发一次 `ASSET_FAIL_TEXT`
- [x] 1.4 `config.schema.ts` 新增 `ASSET_FAIL_TEXT`（默认「有关联附件发送失败，需要的话请回复人工客服～」）

## 2. 素材删除

- [x] 2.1 `AssetService.delete` 对 `file` 与 `video` 均清理落盘文件（按 `url` 基名）

## 3. 租户状态

- [x] 3.1 新增迁移 `apps/adapter/src/platform/018-tenant-trialing.sql`，`chk_tenant_status` 纳入 `trialing`（幂等）
- [x] 3.2 确认部署配置引用新迁移（`scripts/check-migrations.sh` 通过）

## 4. 测试

- [x] 4.1 `asset-sender.service.spec.ts`：link 带标题、相对路径映射、返回 false 不抛
- [x] 4.2 编排器用例：素材失败 → 仅一次降级提示，成功 → 无提示
- [x] 4.3 `asset.service.spec.ts`：video 删除同时清文件
- [x] 4.4 迁移用例：`018` 被部署脚本/契约测试引用

## 5. 文档对齐（概设 V1.28 / 详设 V1.18）

- [x] 5.1 概设 M8：删除为物理删除（无 enabled 列）、file/video 均清理、失败补发降级话术、limit 语义
- [x] 5.2 概设 M11 + 详设 §3.10：订阅状态机按实际（grace 无只读限制；grace+7d → paused=suspended 别名并 `docker compose stop`）
- [x] 5.3 概设 §7.4：status 枚举补 `trialing`；配额列名与规格名映射说明
- [x] 5.4 详设 §1：设计基线 PG16/Mongo7；文首上游版本 V1.27、日期 2026-10-30
- [x] 5.5 概设 M2 / 详设 §3.2：触发词样例与 `config/keywords.yml` 一致并说明前缀匹配
- [x] 5.6 概设 M1：`uploadMedia(type, filePath)`、`sendFile(chatId, mediaId)`
- [x] 5.7 详设 §3.4/§3.9：`engine.ask`、`ensureDataset`+`writeBatch` 表述
- [x] 5.8 详设 §7：license 复核为自调度（非 cron）；03:00 提醒与 09:00 订阅提醒区分
- [x] 5.9 概设 §8.1 回调响应空体、§6.4 繁忙话术、§7.1 asset.url 与落盘命名、§6.2 M5 异步写入
- [x] 5.10 部署手册 §1 关联文档版本行同步
