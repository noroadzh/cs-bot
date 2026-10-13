# Proposal: cs-bot 核心缺陷修复

## Why

cs-bot-mvp-foundation 已归档并通过编译，但功能核对时发现三处偏离设计的关键缺陷，若不修复将直接影响交付质量：

1. **QA 编排与企微客户端循环依赖**：`QaOrchestrator` 导入 `WecomClient`，而 `WecomController → RoutingService → QaModule → QaOrchestrator`，形成 `Qa → Wecom → Qa` 的循环引用。违反概要设计 D1 单向依赖链；模块替换为 FastGPT 真实引擎或新增可观测埋点时，初始化顺序会出非预期。
2. **License 模式开关形同虚设**：`LicenseService` 构造函数中 `USE_MOCK_LICENSE` 三元表达式的两个分支均返回 `MockLicenseVerifier`。即使关闭 mock 模式，也不会切换到 `NativeLicenseVerifier`，无法在不修代码的情况下注入 Rust 原生模块。直接违反 `license-skeleton` spec 的 `Native verifier selected` 场景。
3. **Miss 导出流式未实现**：`MissExportService.buildStream()` 仅返回占位接口，未实际使用 `exceljs.WorkbookWriter` 写出百万行级数据。导出大窗口（一年）时会撑爆内存。直接违反 `miss-record` spec 的 `xlsx export` 场景。

此外发现 `apps/adapter/src/miss/miss-cleanup.service.ts` 已存在但未注册 `@Cron`，对应 `miss-record` spec 的 03:30 清理任务未真正生效；本 change 一并补齐。

## What Changes

- 修复 `apps/adapter/src/qa/qa-orchestrator.ts` 移除对 `WecomClient` 的直接依赖，改为通过抽象的 `IMessageSender` 端口注入；`WecomModule` 提供该实现，解除 `Qa → Wecom` 的反向边。
- 修复 `apps/adapter/src/license/license.service.ts` 的 `USE_MOCK_LICENSE` 分支：当 `USE_MOCK_LICENSE=false` 时返回 `NativeLicenseVerifier`（仍保留占位实现，确保 mock 测试可用），并在启动日志中显式输出当前模式。
- 补全 `apps/adapter/src/miss/miss-export.service.ts` 的 `WorkbookWriter` 流式实现，`GET /admin/miss-records?format=xlsx` 走流式响应，`format=json` 走 `Res.json`。
- 修复 `apps/adapter/src/miss/miss-cleanup.service.ts` 注册 `@Cron` 调度，移除不存在的 `MissCleanupService` 在 `MissModule` 之外的孤儿注册。
- 上述三处修复均通过单元测试覆盖（新增 `qa-orchestrator.spec.ts` 的 `IMessageSender` 注入分支、`license.service.spec.ts` 的模式切换分支、`miss-export.service.spec.ts` 的流式断言）。
- 在 `cs-bot-test-suite` change 的 `unit-testing` 能力上追加**修复验证场景**（不新建 change），并保持 `pipeline-smoke` 不变。

## Capabilities

### New Capabilities

- `cycle-dependency`: 定义模块依赖纪律（单向链约束、抽象端口注入、NestJS DI 范围）。
- `license-mock-switch`: 定义 `USE_MOCK_LICENSE` 在 `LicenseService` 工厂中的实际分支契约（已新增在 `license-skeleton` spec 之下作为 Requirement 增量，本 change 落地）。

### Modified Capabilities

- `license-skeleton`: 追加 `## ADDED Requirements` 明确 `LicenseService.USE_MOCK_LICENSE=false` MUST 返回 `NativeLicenseVerifier`（即便占位也必须切换类型）。
- `miss-record`: 追加 `## ADDED Requirements` 明确 xlsx 导出 MUST 通过 `WorkbookWriter` 流式写出。
- `message-routing` 间接联动：移除 `Qa → Wecom` 边后，模块依赖关系无破坏，不修改 spec。
- `qa-orchestration` 间接联动：抽象 `IMessageSender` 后，QA 不再关心下游，spec 不变。

## Impact

- 代码（4 个文件）：
  - `apps/adapter/src/qa/qa-orchestrator.ts` —— 移除 `WecomClient` 依赖，注入 `IMessageSender`；
  - `apps/adapter/src/qa/qa.module.ts` / `qa-engine.module.ts` —— 增加 `IMessageSender` provider；
  - `apps/adapter/src/wecom/wecom.module.ts` / `wecom-client.ts` —— 实现 `IMessageSender`；
  - `apps/adapter/src/license/license.service.ts` —— 修复 `USE_MOCK_LICENSE` 分支；
  - `apps/adapter/src/miss/miss-export.service.ts` —— 补全 `WorkbookWriter` 流式；
  - `apps/adapter/src/miss/miss-cleanup.service.ts` —— 注册 `@Cron`；
  - `apps/adapter/src/miss/miss.module.ts` —— 注册 cleanup service。
- 测试（3 个新 spec / 现有 spec 补充断言）：
  - 新增 `apps/adapter/test/qa-orchestrator.spec.ts`（`IMessageSender` 注入断言）；
  - 新增 `apps/adapter/test/license.service.spec.ts`（模式切换 + 缓存断言）；
  - 新增 `apps/adapter/test/miss-export.service.spec.ts`（流式 xlsx 断言）。
- 依赖：无新增运行时依赖；`exceljs` 已在 devDependencies 之中。
- 不影响：部署套件、已归档 mvp-foundation 的 11 个能力 spec 主条目。
- 验证入口：`pnpm -C apps/adapter test`、`pnpm -C apps/adapter build`、手动 `curl -u admin:dev http://localhost:3000/admin/license` 验证 `mock` 字段。
