# Design: cs-bot-bugfix-core

## Context

cs-bot-mvp-foundation 已归档，编译通过，但功能核对发现三处设计偏离（循环依赖、License mock 开关失灵、miss 导出流式未实现），均属设计明确要求但实现遗漏的情况。

本设计在不对已归档 spec 做破坏性修改的前提下，通过**增量 delta spec** 的方式明确契约，并落地代码修复与对应单元测试。

## Goals / Non-Goals

**Goals**:
- 消除 `QaOrchestrator → WecomClient` 的循环依赖，满足 D1 单向依赖链约束。
- `LicenseService` 在 `USE_MOCK_LICENSE=true` 时返回 `MockLicenseVerifier`，`false` 时返回 `NativeLicenseVerifier`。
- `MissExportService` 支持流式 xlsx 导出，不在内存堆积全量数据。
- `MissCleanupService` 在 `miss-record` spec 的 03:30 调度下实际执行清理。
- 上述三项修复均有单元测试覆盖。

**Non-Goals**:
- 不修改已归档的 11 个能力 spec 主条目（仅追加 delta requirement）。
- 不实现 `NativeLicenseVerifier` 的真实 Rust 调用（保持占位，返回 mock valid）。
- 不改变 `QaOrchestrator` 的业务逻辑（只移依赖，不改流程顺序）。
- 不重写 `WecomClient`（仅暴露 `IMessageSender` 抽象层）。

## Decisions

### 决策 1：循环依赖——抽象 IMessageSender 端口

**方案**：从 `QaOrchestrator` 中移除 `WecomClient` 的直接导入，改为注入 `IMessageSender` 接口：

```typescript
// src/qa/message-sender.port.ts
export interface IMessageSender {
  sendText(chatId: string, content: string, atUser?: string): Promise<void>;
  sendAsset(chatId: string, assetId: string, type: 'link' | 'file' | 'video'): Promise<void>;
}
```

- `WecomClient` 实现该接口，`WecomModule` 导出 `IMessageSender`。
- `QaOrchestrator` 依赖 `IMessageSender`，通过 NestJS DI 注入。
- `QaModule` 不再导入 `WecomModule`，打破 `Qa → Wecom` 边。
- `wecom.module.ts` 变为 `QaModule` 的下游（单向）。

**备选**：将 `QaOrchestrator` 拆分为"编排"与"发送"两个服务。**否决**：过度设计，当前只需解耦发送依赖。

**取舍**：接口隔离最小侵入，3 个文件改动物价。

### 决策 2：License 模式开关修复

**方案**：修正 `LicenseService` 构造函数中的三元表达式：

```typescript
this.verifier = cfg.USE_MOCK_LICENSE
  ? new MockLicenseVerifier()
  : new NativeLicenseVerifier(); // TODO: 注入 packages/license-native/prebuilds
```

- `NativeLicenseVerifier` 暂时实现为返回 `{ valid: true, reason: 'native-placeholder', mock: false }`。
- `license.service.ts` 启动日志明确输出当前 verifier 类型：`{ mock: state.mock }`。
- 测试覆盖两种模式切换：检查 `verifyAndCache()` 返回的 `mock` 字段为 `true`/`false`。

**备选**：使用 NestJS 的工厂 provider 动态返回。**否决**：当前 `LicenseService` 已通过构造函数注入配置，简单分支即可。

**取舍**：最小修复，不引入工厂 provider 的复杂度。

### 决策 3：Miss 导出流式实现

**方案**：使用 `ExcelJS.stream.xlsx.WorkbookWriter` 流式写出：

```typescript
async exportXlsx(days: number, res: Response): Promise<void> {
  const rows = await this.queryRecords(days);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
  const sheet = workbook.addWorksheet('miss-records');
  sheet.addRow(['traceId','chatId','userId','question','score','engine','createdAt']).font = { bold: true };
  for (const row of rows) {
    sheet.addRow([...]);
  }
  await workbook.commit();
}
```

- `MissController` 改为直接调用 `MissExportService.exportXlsx(res, days)` 而非 `queryRecords`。
- `miss.controller.ts` 注入 `MissExportService`，不在 controller 层构造 Pool。
- xlsx 响应头：`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，`Content-Disposition: attachment; filename="miss-records_<from>_<to>.xlsx"`。
- json 格式保持 `res.json({ total, items })` 不变。

**备选**：分页查询（每页 5000 条，stream 写入）。**否决**：`ExcelJS.stream.xlsx` 已内置流式，无需手动分页。

**取舍**：最小改动 `miss-export.service.ts` + `miss.controller.ts`。

### 决策 4：MissCleanupService 注册

**方案**：在 `miss.module.ts` 中注册 `MissCleanupService`，在 service 上添加 `@Cron('30 3 * * *', { timeZone: 'Asia/Shanghai' })`：

```typescript
@Injectable()
export class MissCleanupService {
  constructor(private readonly pool: Pool) {}

  @Cron('30 3 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanup() {
    const days = ConfigService.instance.MISS_RECORD_RETENTION_DAYS;
    const result = await this.pool.query(
      `DELETE FROM miss_record WHERE created_at < now() - interval '${days} days'`
    );
    // ...
  }
}
```

- 移除 `admin.module.ts` 中对 `TriggerService` 的重复注册（已在 `routing.module.ts` 注册）。
- 确保 `MissModule` 已在 `app.module.ts` 中导入（已确认存在）。

**取舍**：`@nestjs/schedule` 已在 `AppModule` 通过 `ScheduleModule.forRoot()` 启用，直接使用 `@Cron` 即可。

## Risks / Trade-offs

### R1：IMessageSender 接口变更影响范围
[Risk] 抽象层引入后，若 `WecomClient` 后续新增 `sendImage/sendMarkdown` 等方法，需同步更新接口。  
**Mitigation**：接口仅暴露当前 `QaOrchestrator` 需要的两个方法；后续扩展走接口扩展而非修改现有签名。

### R2：NativeLicenseVerifier 占位返回 valid=true
[Risk] 开发者误认为 `USE_MOCK_LICENSE=false` 即已接入 Rust native，实际仍在跑 mock 逻辑。  
**Mitigation**：启动日志明确打印 `{ verifier: 'native-placeholder' }`；`/admin/license` 返回 `mock: false` 供管理员确认；README 注明当前阶段仍需手动注入 `.node` 文件。

### R3：WorkbookWriter stream 与 response close
[Risk] 客户端提前关闭连接时，`WorkbookWriter.commit()` 可能报 `ERR_STREAM_PREMATURE_CLOSE`。  
**Mitigation**：在 `commit()` 外层 `try/catch`，异常仅打印 WARN 日志，不向上抛出（导出失败不影响业务流）。

### R4：MissCleanupService cron 依赖 ScheduleModule
[Risk] 若误删 `ScheduleModule.forRoot()`（在 `app.module.ts` 中），cron 静默不触发。  
**Mitigation**：在 `cleanup()` 中加入 `onModuleInit` 健康检查，若 cron 5 分钟内未触发则 WARN。
