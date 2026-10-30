# Proposal

## Why

第十一轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-11.md`）发现：`platform-monitoring` 规格与概设 M11 都要求聚合租户实例的**容器资源使用**，但 `/healthz` 不输出 CPU/内存，`HttpHealthSource` 的 `cpuPct/memPct` 从未赋值，`/platform/usage` 里资源水位恒为空，也没有水位告警。运营无法在租户实例 OOM/CPU 打满前介入。

## What Changes

- **指标暴露**：`/healthz` 增加 `resources: { cpuPct, memPct }`（cgroup v2 `memory.max/current` 优先，回退 cgroup v1 / `os.totalmem`；CPU 用 loadavg 归一）。
- **聚合与告警**：`HttpHealthSource` 映射资源字段；`GET /platform/usage` 返回每实例资源水位；`PlatformMonitor` 在连续 N 次（默认 3）任一指标 ≥ 阈值（默认 90%）时推送 `tenant.alert`（原因 `resource_high`，窗口去重），**不触发重启**。
- **配置**：`PLATFORM_RESOURCE_ALERT_PCT`（默认 90）、`PLATFORM_RESOURCE_ALERT_STREAK`（默认 3）。
- **文档补齐**：详设 §7 补审计清理 03:50；概设 §8.3 与 M11 接口清单补已实现端点（或注明以 Swagger/详设 §6 为准）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `platform-monitoring`：明确资源指标字段与水位告警行为。

## Impact

- **代码**：新增 `apps/adapter/src/common/resource-metrics.ts`；`health.controller.ts`、`platform-monitor.ts`、`config.schema.ts`。
- **测试**：新增 `resource-metrics.spec.ts`；`health.controller.spec.ts`、`platform-monitor.spec.ts` 补断言。
- **文档**：详设 §7、概设 §8.3/M11、版本记录。
