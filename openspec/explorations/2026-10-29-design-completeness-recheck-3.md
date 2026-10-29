# 概要/详细设计完整性复核（第三轮，2026-10-29，只读）

## 范围与方法

- 以 `docs/02-需求与设计/概要设计...md`（V1.9）与 `详细设计...md`（V1.1）为基准，逐项核对 M1–M11、DDL、Redis 键、API 契约、定时任务。
- 对照实现代码、主规格与测试，只读检查，不修改代码。

## 结论

**功能层面已全部完成**：M1–M11 主链路、增项 A/B/C、授权与交付边界均有实现与测试；前两轮与交付打包变更的缺口均已闭环。本轮**未发现新的功能缺失**。

发现 6 处「设计文档与实现契约漂移」。这些是文档沿革造成的口径不一致（实现与主规格一致），不是功能未实现；但详细设计声明接口契约冻结、二期原样复用，建议修订文档避免误导。

## 漂移清单

| # | 设计文档 | 实际实现 / 规格 | 证据 |
|---|---|---|---|
| 1 | 详设 §6.3 导入接口 `/admin/import/jobs...` | `/admin/import-jobs...` | `apps/adapter/src/import/import.controller.ts:50`；`openspec/specs/import-job/spec.md:11` |
| 2 | 详设 §6.3 confirm body `{items:[{itemId, action: keep/modify/reject, modified?}]}` | `{decisions:[{itemId, reviewStatus: approved/rejected}]}` | `import.controller.ts:268-274`、`import-confirm.ts:21-35` |
| 3 | 详设 §6.2 素材 `POST /admin/assets` 入参 `type,title`，返回 `{id}` | 入参 `file` 或 `{url,name}`；返回 `{success, asset}` | `media/dto/asset-create.dto.ts:9-14`、`asset.controller.ts:41-90` |
| 4 | 详设 §5 Redis 键：`rl:group/rl:user`（令牌桶 Lua）、`report:buffer`（list）、`import:queue`（持久 list） | 限流用 `rate:group:{chatId}:{minute}` 固定窗口；上报缓冲落 `data/report-buffer.json`；导入队列为进程内 `ImportTaskQueue` | `routing/rate-limiter.service.ts:51-52`、`usage/usage-reporter.scheduler.ts:18`、`import/import-task-queue.ts:4-10` |
| 5 | 详设 §4 DDL：`schema=adapter` 前缀、`adapter.keyword_trigger` 表 | 迁移建表未加 schema；关键词来自 `config/keywords.yml`，无 `keyword_trigger` 表 | `apps/adapter/src/miss/001-miss-record.sql:2`、`routing/trigger.service.ts:25-35`；详设 §3.2 本身也写文件词表 |
| 6 | 详设 §3.10 用量上报 body 仅 `{tenantId,date,msgsIn,triggered,hit,miss,tokens,activeChats}` | 增加 `docCount/qaCount/assetMb` | `usage/usage-reporter.scheduler.ts:24-38`、`openspec/specs/usage-reporting/spec.md` |

附带的文档内不一致：

- 部署手册第 403 行用 `/admin/import-jobs/:id`，第 432 行用 `/admin/import/jobs/:id`。
- 详设 §5 写 `import:queue` 为 Redis 持久 list，§3.9 又写“进程内 BullMQ-lite”，自相矛盾；实现取进程内。

## 已接受限制（非缺口）

- 群聊不支持被动回复（企微 appchat 限制）。
- grace 期知识库只读依赖 FastGPT 后台外部配置。
- 管理面为纯 API，可视化归二期。
- 租户导出以 Mongo 全量 dump 表达知识库。
- 真实多租户 UAT 受环境限制。
- 工作日按周一至周五计算，未接法定节假日日历。

## 建议

新建一个仅文档对齐的 OpenSpec 变更（`skip_specs: true`，不改代码与主规格）：

1. 详设 §6.2/§6.3 改为实际路径、入参与返回。
2. 详设 §5 键表改为 `rate:*`、文件缓冲、进程内队列；删除或标注未使用的 `license:cache`、`import:queue`。
3. 详设 §4 去掉未落的 `adapter` schema 与 `keyword_trigger` 表，或标注“由 keywords.yml 替代”。
4. 详设 §3.10 补容量字段。
5. 手册第 432 行路径改为 `/admin/import-jobs/:id`。
