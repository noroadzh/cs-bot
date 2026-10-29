# 概要/详细设计完整性复核（第二轮，2026-10-28，只读）

## 范围

对 `complete-design-runtime-gaps` 归档后的实现再次核对 M1–M11，重点检查新引入逻辑与运维契约。

## 结论

上一轮 P0/P1/P2 主体已闭环；仍发现 3 项 P1、若干 P2，主要是“新增能力未被实际消费/未同步文档”的问题，而非主链路缺失。

## P1

1. **容量配额只存储不执行**
   - `tenant_quota` 已增加 `max_docs/max_qa/max_asset_mb`（迁移 016、`tenant-quota.service.ts`），但数据面 `TenantGateService` 仍只校验 `chat`/`api_call`；资产上传、导入确认、FastGPT 文档增长均未检查这些维度。
   - 影响：运营设置的文档/QA/素材配额不会生效。
   - 建议：在 `AssetService` 上传、`confirm()` 入库前读取本地 `tenant_quota` 并校验；或在设计/API 中明确这三项为“只读统计”而非硬配额。

2. **运维手册命令在 ReasonGuard 下会 400**
   - 本轮为所有平台变更加了必填 `reason`（`PlatformReasonGuard`），但部署手册中的 `PUT /platform/tenants/:id/secrets`、`POST .../provision`、`POST .../restart`、`POST .../credentials/handoff` 示例没有 `reason`。
   - 证据：`docs/03-交付实施/部署手册...md:571,575,585`。
   - 建议：文档命令统一加 `-H 'x-operator-reason: ...'` 或 body `reason`。

3. **异步导入的内存基线未重置**
   - `ImportJobService.startParse` 的后台任务 `finally` 只释放租约，没有把 `importBaselineRss` 归零（同步 `parseJob` 有归零）；第一个异步导入后，后续任务会拿旧基线计算增量，可能误暂停或漏暂停。
   - 证据：`apps/adapter/src/import/import-job.service.ts:243-252`、`guardMemory()`。
   - 建议：在后台任务 `finally` 同时 `this.importBaselineRss = 0`。

## P2

4. **审计动作词表缺 `tenant.credentials`**
   - 代码在凭证交接时写 `tenant.credentials`（`tenant.service.ts:685`），但 `platform-audit` 主规格的固定动作列表没有该值，违反“No other action MAY be written”。
   - 建议：把 `tenant.credentials` 加入规格动作表（带 `{tenantId, keys}` payload），或复用已有动作。

5. **升级通知只到运维 webhook**
   - `ShellUpgradeDeps.notify` 只向 `OPS_WEBHOOK_URL` 发一条“请通知租户”的消息；设计 M11 要求提前 3 个工作日通知租户。当前没有租户联系人/邮件通道的使用。
   - 建议：为 tenant 增加 contact 字段并复用 EmailWebhookNotifier，或在规格中明确由运维人工转达。

6. **审计异地留存是手工脚本**
   - `scripts/export-audit.mjs` 只提供导出；180 天清理仍由 `PlatformAuditService` 本地 cron 执行，没有自动上传异地。
   - 设计 M11 要求异地留存 180 天；当前依赖部署方定时执行脚本并外传。
   - 建议：部署手册明确 cron + 对象存储/日志平台接入，或接受为运维约定。

7. **容量用量 `docCount` 为 best-effort**
   - `CapacityUsageService.countDocs` 调 FastGPT `/api/v1/core/dataset/collection/list`，失败仅告警返回 0；不同 FastGPT 版本/路径差异会导致容量报表低估。
   - 建议：固化 FastGPT 版本适配并补集成测试，或改为从 MongoDB 统计。

8. **姓名脱敏仅覆盖带标签场景**
   - `SensitiveRedactor` 的 `NAME` 仅匹配“姓名/联系人/收货人：xxx”，不带标签的真实姓名不会脱敏；地址正则也要求省市区+路/号等后缀。
   - 这是为避免误伤的保守策略，设计 M10 要求“姓名模式/详细地址”；建议在规格/操作手册注明覆盖边界，或引入词典。

## 已接受/非新缺口

- 群聊不支持被动回复（appchat 限制）。
- grace 期知识库只读依赖 FastGPT 后台外部配置，产品不控制 FastGPT 写操作。
- 租户导出以 Mongo 全量 dump 表达知识库（设计与规格已对齐）。
- UI/mTLS、控制面独立目录、5.4 真实多租户 UAT 环境限制。

## 建议

先修 P1 三项（配额执行、文档 reason、异步导入基线），P2 视排期合并。若按 OpenSpec 流程，新建一个 `close-runtime-followups` 变更承载。
