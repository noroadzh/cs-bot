# Tasks

## 1. 容量配额执行（P1）

- [x] 1.1 新增数据面 `CapacityGuard`：读取本租户 `tenant_quota`，提供 `checkAsset(newBytes)` / `checkImport(newQa, newDocs)`；`TENANT_ID` 为空或配额为 0 时放行；验证：单测覆盖 0 不限、非 M11 放行、三配额超限返回 409。
- [x] 1.2 `AssetService.upload` 落盘前调用 `checkAsset`，超限返回 409 `TENANT_QUOTA_EXCEEDED` 且不写文件；验证：单测断言超限无文件、未超限计入目录字节。
- [x] 1.3 `ImportJobService.confirm` 写数据集前调用 `checkImport`（approved_qa 现量 + 本次 approved/modified），超限 409 且不写数据集、不标记 imported；文档数读取失败 fail-closed 503；验证：集成测试三条路径。
- [x] 1.4 文档补充容量配额行为与错误码；验证：章节与实现一致。

## 2. 异步导入基线（P1）

- [x] 2.1 `startParse` 后台任务 finally 重置 `importBaselineRss`，与同步路径一致；验证：单测连续两个异步任务，断言每次重新建立基线。
- [x] 2.2 回归 `import-memory`/导入 e2e；验证：全绿。

## 3. 运维 reason 文档（P1）

- [x] 3.1 部署手册 `secrets/provision/restart/credentials handoff/export/destroy` 示例统一补 `reason`（body 或 `X-Operator-Reason`）；验证：逐条命令可复制执行，不再 400。
- [x] 3.2 操作说明标注 `POST /platform/report` 为机器上报豁免；验证：文档与 `PlatformReasonGuard` 一致。

## 4. 审计词表与异地留存（P2）

- [x] 4.1 `tenant.credentials` 加入 `platform-audit` 主规格动作表（已在 delta），代码审计 payload 只含 key 名；验证：单测断言动作与 payload。
- [x] 4.2 新增 `PLATFORM_AUDIT_ARCHIVE_DIR`（默认 `backup/audit`）；`PlatformAuditService.handleCleanup` 先导出 180 天前 JSONL，成功后才删除；失败保留并 error；验证：单测成功删除、导出失败不删。
- [x] 4.3 复用 `scripts/export-audit.mjs` 的导出格式，文档补 cron/异地流程；验证：脚本与 service 输出一致。

## 5. 租户升级通知（P2）

- [x] 5.3 新增迁移 `017-tenant-contact.sql`（tenant.contact）并登记 compose/Dockerfile；`Tenant` 创建时写入 contact；验证：迁移幂等、创建后 detail 可见 contact。
- [x] 5.1 `Tenant` 映射补 `contact`；`ShellUpgradeDeps.notify` 优先发租户 contact（EmailWebhook），无联系人回退 `OPS_WEBHOOK_URL` 并审计 `tenant.alert` fallback；验证：单测两条路径与 3 天窗口。
- [x] 5.2 文档更新升级通知触点；验证：手册步骤可执行。

## 6. 容量统计可靠性（P2）

- [x] 6.1 `CapacityUsageService.countDocuments` 以 FastGPT 数据集 collection list 为权威来源，失败抛错；`UsageReporterScheduler` 失败进入缓冲重试，不发送 `docCount:0`；验证：单测成功计数、失败缓冲。
- [x] 6.2 文档说明 docCount 来源与失败重试；验证：文档一致。

## 7. 姓名词典脱敏（P2）

- [x] 7.1 `SensitiveRedactor` 加载 `config/import-names.txt`（最长优先、空行忽略、缺失告警不阻塞）；合并标签规则匹配；验证：单测词典命中、无标签命中、缺失文件仍走标签、长名优先。
- [x] 7.2 部署手册/导入说明补词典路径与维护方式；验证：文档与配置一致。

## 8. 验证与归档

- [x] 8.1 全量单测、集成、验收、迁移与 compose config 通过。
- [x] 8.2 重建镜像并验证非 root/可写/迁移；更新设计文档。
- [x] 8.3 更新设计文档与操作手册；验证：文档与实现一致。

## 9. verify 反馈收口

- [x] 9.1 升级通知提前期按工作日计算（跳过周六/周日），窗口日期不足 3 个工作日则顺延；验证：单测覆盖跨周末场景。
- [x] 9.2 审计清理补“保留窗口内记录既不导出也不删除”的测试；验证：`audit-archive.spec.ts`。
- [x] 9.3 用量上报补“快照不可用时跳过发送、不发 docCount:0”的调度器测试；验证：新增 `usage-reporter.spec.ts`。
- [x] 9.4 素材上传补“守卫放行时正常落盘”的测试；验证：`asset.service.spec.ts`。
- [x] 9.5 修正 `design.md`：迁移计划改为新增 017 contact 迁移；回滚说明改为配额置 0/回滚镜像，去掉不存在的 `PLATFORM_CAPACITY_ENFORCE`。

## Workflow follow-up

- 完成后 `/opsx:verify close-runtime-followups`，通过后 `/opsx:archive`。
