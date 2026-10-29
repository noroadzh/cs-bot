# 概要/详细设计完整性复核（第四轮，2026-10-29，只读）

## 范围与方法

- 文档对齐（`align-design-docs-contracts`）归档后，按概设 V1.10 / 详设 V1.2 的 M1–M11 功能条目逐项核对实现。
- 只读检查代码、配置、迁移与测试，不修改任何文件。

## 结论

**设计中的功能已全部完成。** 各模块的职责、关键流程与接口均有实现；未发现未实现的功能条目。仅剩 4 处非功能的文档细节偏差（不影响运行与契约）。

## 逐模块核对

| 模块 | 关键实现证据 |
|---|---|
| M1 企微接入 | `wecom/wecom-crypto.ts`（验签/AES）、`wecom-client.ts:74-190`（sendText/uploadMedia/sendFile/sendVideo/downloadMedia、token 缓存与刷新锁） |
| M2 路由触发 | `routing/trigger.service.ts`（keywords.yml + `triggers.prefixes`）、`routing.service.ts`（非触发静默、去重前置）、`dedup.service.ts`（48h NX）、`rate-limiter.service.ts`（群 20/人 5 每分钟 + 5 分钟提示去重） |
| M3 上下文 | `context/context.service.ts`（`ctx:{chat}:{user}`、5 轮、600s 滑动续期、Redis 失败 fail-open） |
| M4 问答编排 | `qa/fastgpt-qa.engine.ts`（15s 超时、1s 重试、阈值判定）、`qa-orchestrator.ts:148-158`（来源最多 2 条）、拒答触发 M5 |
| M5 未命中 | `admin/miss.controller.ts`、`miss-export.service.ts`（xlsx 流）、`miss-cleanup.service.ts`（90 天） |
| M6 敏感词 | `filter/sensitive-filter.service.ts`（DFA + `fs.watch` 热重建 + 整段替换话术） |
| M7 配置 | `config/config.schema.ts`、`admin/config.controller.ts`（config-check / reload / keywords reload）、密钥打码 |
| M8 多媒体 | `wecom.controller.ts:213-226`（qwen-vl 图片识别）、`media/asset-reference.resolver.ts`（`[[素材:<id>]]`、上限 2）、`asset-sender.service.ts`（link/file/video 与降级） |
| M9 授权 | `license/native-license.verifier.ts`（验签/指纹/回拨）、`license-gate.service.ts:103`（maxChats 拦截）、`license-runtime.scheduler.ts`（03:00 复核）、`health.controller.ts:32-50`（受限模式 503）、`/admin/license/reload` |
| M10 导入 | `import/import-parser.ts`（CSV/JSONL/TXT/XLSX）、`conversation-parser.ts`（30 分钟窗口配对）、`import-confirm.ts`、`import-cleanup.service.ts`（30/180 天）、`import-task-queue.ts`（单任务）、`import-job.service.ts`（80% 暫挂） |
| M11 控制面 | `platform/provisioner/shell-provisioner.ts`（渲染/编排）、`012-tenant-ports.sql`（30000 步长 10）、`certificate-provider.ts`、`tenant-quota.service.ts`、`tenant-expiry-sweep.service.ts`（T-30/15/7、grace 7d、30d flag）、`upgrade-orchestrator.ts`（金丝雀/回滚/工作日通知）、`platform-audit.service.ts`、`tenant-offboarding.ts`（导出→7 天→删除确认）、`platform-monitor.ts` |

## 文档细节残留（非功能缺口）

1. 详设 §3.10 写“模板渲染 `env.hbs` + `compose.overrides.hbs`”；实现为 `shell-provisioner.ts` 内联生成 compose（无 hbs 文件）。
2. 详设 §3.9 写三种解析器（ArchiveJson/Xlsx/CsvTxt）；实现支持 CSV/JSONL/TXT/XLSX 四种（超集，规格以 import-job 为准）。
3. 概设 M2 写限流为“INCR+EXPIRE 滑动窗口”；实现为按分钟固定窗口（详设 §5 已按实际修正）。
4. 概设 M8 写素材标记 `[[素材:(\d+)]]`；实现为 UUID：`[[素材:([a-f0-9-]+)]]`。

以上均不影响功能与外部契约；如需完全一致，可再开一个 `skip_specs` 文档变更一次性修订。

## 已接受限制（非缺口）

- 群聊不支持被动回复（企微 appchat 限制）。
- grace 期知识库只读依赖 FastGPT 后台外部配置。
- 管理面为纯 API，可视化归二期。
- 租户导出以 Mongo 全量 dump 表达知识库。
- 真实多租户 UAT 受环境限制。
- 工作日按周一至周五计算，未接法定节假日日历。
