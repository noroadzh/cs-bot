# Design

## Context

见 proposal.md。`InstanceHealth` 已预留 `cpuPct?/memPct?`，`HealthSource.probe` 未填充；`/healthz` 只返回 license 与 usage 计数。

## Goals / Non-Goals

**Goals:**

- 每个实例的 CPU/内存水位可见（healthz → monitor → `/platform/usage`）。
- 持续高水位可告警，但不自动重启（重启由存活探针负责）。

**Non-Goals:**

- 不引入 Prometheus/外部监控栈。
- 不做逐容器 cgroup 精确核账（adapter 只报告自身进程所在容器的 cgroup）。

## Decisions

### D1 `resource-metrics.ts`

```ts
export interface ResourceMetrics { cpuPct: number; memPct: number }
export function readResourceMetrics(now?: () => number): ResourceMetrics
```

- **内存**：优先 cgroup v2（`/sys/fs/cgroup/memory.max` 与 `memory.current`）；其次 v1（`memory.limit_in_bytes` / `usage_in_bytes`）；`max`/超大值或读取失败时回退 `os.totalmem()/os.freemem()`。
- **CPU**：`os.loadavg()[0] / os.cpus().length * 100`，钳制 0–100。loadavg 是宿主视角的近似，容器 CPU 限额下仍能反映压力趋势；避免采样间隔状态。
- 结果四舍五入到 1 位小数；任何异常返回 `{cpuPct: 0, memPct: 0}`（健康检查不能因指标失败而 500）。

### D2 `/healthz` 输出

在 `ok` 与 `degraded` 两种响应中都加 `resources`：

```json
{ "status":"ok", "license":{...}, "usage":{...}, "resources":{"cpuPct":12.3,"memPct":41.8} }
```

字段为附加项，不改变既有断言/契约。

### D3 聚合与告警

- `HttpHealthSource.probe`：`resources = resp.data?.resources ?? {}`，映射 `cpuPct/memPct`（缺失则 undefined）。
- `PlatformMonitor.tick`：新增 `resourceHits: Map<tenantId, number>`：
  - 任一指标 ≥ `resourceAlertPct`（默认 90）→ hits+1；否则清零。
  - hits ≥ `resourceAlertStreak`（默认 3）→ `alert(id,'resource_high',{cpuPct,memPct})`，随后清零。
  - `alert()` 已有 `alertWindowMs` 去重；不调用 `restart`。
- 配置：`PLATFORM_RESOURCE_ALERT_PCT`、`PLATFORM_RESOURCE_ALERT_STREAK`。

### D4 文档

- 详设 §7 增「审计清理 50 3」行。
- 概设 §8.3 补缺失端点并注明「完整清单以 Swagger `/docs` 与详设 §6 为准」；M11 接口表补 provision/restart/secrets/credentials/shell-access/audit verify/sweep/report。

## Risks / Trade-offs

- [loadavg 在低核数机器上抖动] → 阈值 90% + 连续 3 次，避免瞬时误报。
- [cgroup 路径差异] → 多级回退，最差退化为宿主内存比例，仍能反映趋势。
- [healthz 变重] → 仅两次 stat + loadavg，微秒级。

## Migration Plan

无数据库/配置破坏性变更，新配置有默认值；回滚恢复上一镜像即可。

## Verification

- `resource-metrics.spec.ts`：cgroup v2 / v1 / 回退 totalmem 三条路径 + 异常兜底。
- `health.controller.spec.ts`：两种响应都含 `resources`。
- `platform-monitor.spec.ts`：连续 3 次高水位告警一次、单次尖峰不告警、不触发重启；`probe` 映射资源字段。
- 全量单测/集成/验收通过。
