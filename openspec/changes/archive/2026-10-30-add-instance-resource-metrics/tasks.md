# Tasks

## 1. 资源指标

- [x] 1.1 新增 `common/resource-metrics.ts`（cgroup v2/v1/回退 + loadavg CPU）。
- [x] 1.2 `/healthz` 两种响应加 `resources`。

## 2. 聚合与告警

- [x] 2.1 `HttpHealthSource.probe` 映射 `cpuPct/memPct`。
- [x] 2.2 `PlatformMonitor.tick` 连续 N 次 ≥ 阈值告警（`resource_high`，不重启）。
- [x] 2.3 配置 `PLATFORM_RESOURCE_ALERT_PCT` / `PLATFORM_RESOURCE_ALERT_STREAK`。

## 3. 测试

- [x] 3.1 新增 `resource-metrics.spec.ts`。
- [x] 3.2 补 health / monitor 断言（含 `/platform/usage` 暴露资源）。

## 4. 文档

- [x] 4.1 详设 §7 补审计清理 03:50。
- [x] 4.2 概设 §8.3 与 M11 接口清单补全。
- [x] 4.3 版本记录（概设 V1.17 / 详设 V1.10）与引用同步。

## 5. 验证

- [x] 5.1 全量单测、集成、验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify add-instance-resource-metrics`，通过后 `/opsx:archive`。
