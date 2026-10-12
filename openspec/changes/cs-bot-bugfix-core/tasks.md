# Tasks: cs-bot-bugfix-core

- [ ] 1.1 定义 IMessageSender 接口（`src/qa/message-sender.port.ts`）
- [ ] 1.2 WecomClient 实现 IMessageSender（`src/wecom/wecom-client.ts`）
- [ ] 1.3 WecomModule 导出 IMessageSender token（`src/wecom/wecom.module.ts`）
- [ ] 1.4 QaOrchestrator 改用 IMessageSender 注入（`src/qa/qa-orchestrator.ts`）
- [ ] 1.5 QaModule 不再导入 WecomModule（`src/qa/qa.module.ts`）
- [ ] 1.6 新增 qa-orchestrator.spec.ts 覆盖 IMessageSender 注入与分段发送
- [ ] 2.1 修复 LicenseService USE_MOCK_LICENSE 分支返回 NativeLicenseVerifier（`src/license/license.service.ts`）
- [ ] 2.2 新增 NativeLicenseVerifier 占位实现（`src/license/native-license.verifier.ts`）
- [ ] 2.3 新增 license.service.spec.ts 覆盖模式切换与缓存命中
- [ ] 3.1 补全 MissExportService WorkbookWriter 流式 xlsx 导出（`src/miss/miss-export.service.ts`）
- [ ] 3.2 MissController 改用 exportXlsx（`src/admin/miss.controller.ts`）
- [ ] 3.3 MissCleanupService 注册 @Cron 调度（`src/miss/miss-cleanup.service.ts`）
- [ ] 3.4 MissModule 注册 CleanupService provider（`src/miss/miss.module.ts`）
- [ ] 3.5 AdminModule 移除 TriggerService / LicenseService / MissExportService 重复注册（`src/admin/admin.module.ts`）
- [ ] 3.6 新增 miss-export.service.spec.ts 覆盖流式 xlsx 断言
- [ ] 4.1 编译通过（`pnpm -C apps/adapter build`）
- [ ] 4.2 全量 Jest 测试通过（`pnpm -C apps/adapter test`）
- [ ] 4.3 openspec validate --strict 通过
