# Design

## Context

见 proposal.md 与第二轮复核记录。现有数据面已同步 `tenant_quota`，资产在 `data/assets`，导入审核通过后写本地 `approved_qa` 与 FastGPT；平台审计本地保留 180 天；升级通知当前只发运维 webhook。

## Goals / Non-Goals

**Goals:**

- 让已落库的容量配额真正生效，并让超限行为可解释。
- 修正异步导入的基线生命周期。
- 把上一轮新增的运维契约（reason、审计动作、异地留存、租户通知、统计可靠性、姓名词典）补齐。

**Non-Goals:**

- 不试图拦截租户在 FastGPT 后台直接上传文档的行为；外部写入仍由运营流程约束。
- 不改变已有 API 路径与状态词表。

## Decisions

### D1 容量配额：数据面本地执行

新增 `CapacityGuard`（数据面）：

- **素材**：`AssetService.upload` 前统计 `data/assets` 现有字节 + 新文件字节，读取本租户 `tenant_quota.max_asset_mb`；超限抛 409 `TENANT_QUOTA_EXCEEDED`，`kind=max_asset_mb`，不落盘。
- **QA**：`ImportJobService.confirm` 写数据集前统计 `approved_qa` 现有行数 + 本次 `approved/modified`（排除 auto_blocked），对照 `max_qa`；超限 409，不写数据集、不标记 imported。
- **文档**：用 `CapacityUsageService.countDocs()`（FastGPT Mongo）作为现有文档数，加上本次导入将新增的 QA 数（一条 QA 视为一条文档）对照 `max_docs`；无法读取文档数时 **fail-closed** 返回 503，避免无依据放行。
- 0 视为不限；非 M11 部署（`TENANT_ID` 为空）全部放行。

备选“只做统计不拦截”被否：会继续让配额配置失去意义。

### D2 异步导入基线

`startParse` 的后台任务 `finally` 同时 `this.importBaselineRss = 0`，与同步 `parseJob` 一致；新增单测断言两个连续异步任务各自从当前 RSS 建立基线。

### D3 运维 reason

平台变更统一使用 `X-Operator-Reason` 头或 body `reason`；部署手册中 `secrets/provision/restart/credentials handoff/export/destroy` 示例全部补齐。`PLATFORM_REPORT` 等机器上报路径继续豁免。

### D4 审计词表与异地留存

- 动作词表加入 `tenant.credentials`（只记 key 名）。
- 新增 `PLATFORM_AUDIT_ARCHIVE_DIR`（默认 `backup/audit`）与 `scripts/export-audit.mjs` 复用；`PlatformAuditService.handleCleanup` 先导出待删行 JSONL，写入成功后才 `DELETE`；导出失败保留行并 error 日志。保留窗口 180 天。
- 备选“依赖外部 cron 手工导出”被否：容易漏导出导致直接删除。

### D5 升级通知触达租户

新增迁移 017 为 `tenant` 补 `contact` 列，创建时写入；`Tenant` 映射补 `contact`；`ShellUpgradeDeps.notify` 接受 `{tenantId, contact, windowStart}`，优先 `EmailWebhookNotifier` 发租户 contact，缺失时发运维 webhook 并在审计 `tenant.alert` 记录 `fallback: true`。通知仍提前 ≥3 个工作日（`addBusinessDays`，跳过周六/周日）。

### D6 容量统计可靠

`CapacityUsageService.countDocuments()` 以 FastGPT 数据集 collection list 为权威来源（FastGPT 自身由 MongoDB 支撑），读取失败抛错；`UsageReporterScheduler` 捕获后跳过本次上报，下一次调度重试，不发送 `docCount:0`。`qaCount` 仍取本地 `approved_qa`，`assetMb` 取资产目录。

### D7 姓名词典

`SensitiveRedactor` 构造时可加载 `config/import-names.txt`（每行一个姓名，去重、忽略空行）；合并扫描保留标签规则 + 词典字面量匹配，词典缺失仅告警不阻塞解析。词典姓名按最长优先匹配，避免短名截断长名。

## Risks / Trade-offs

- [文档数 fail-closed 可能阻断导入] → 仅在 `max_docs > 0` 时读取；读取失败返回 503 并提示重试，不会静默放行。
- [姓名词典误伤] → 只匹配明确配置的姓名，按最长优先；运营可维护词典。
- [审计导出失败导致本地磁盘增长] → error 日志 + 告警；保留行比丢审计更安全。
- [租户联系人为空] → 回退运维通道并记录 fallback，不阻断升级。

## Migration Plan

1. 新增迁移 `017-tenant-contact.sql`（`tenant.contact`，`ADD COLUMN IF NOT EXISTS` 幂等）；新增配置 `PLATFORM_AUDIT_ARCHIVE_DIR`、`IMPORT_NAMES_FILE`。
2. 先发布数据面（容量守卫、基线、姓名词典），再发布控制面（审计留存、租户通知）。
3. 回滚：容量守卫按配额值生效，临时放开把对应配额置 `0`（不限）；需完全停用时回滚到上一镜像版本。审计留存失败时不会删除本地行，无需额外开关。

## Verification

实施后：单测 96 suites / 939 tests、集成 7 suites / 28 tests、验收 6 suites / 23 tests 通过；迁移 18 个；compose config 通过；镜像重建后验证非 root/可写/含 018 迁移。

- 单测：Asset/Import 超限与放行、0 不限、非 M11 放行；连续异步导入基线；审计导出成功/失败/保留窗口内不动；租户/运维通知回退与 ≥3 个工作日窗口；词典缺失/命中；docCount 失败跳过上报。
- 集成：真实 PG + fake FastGPT/Mongo，验证超限不落盘、审计导出后再删。
- 文档：部署手册平台命令带 reason、审计留存 cron、容量配额说明。
