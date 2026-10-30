# Design

## Context

见 proposal.md。概设 §10.1 已有内存预算表，但 compose 未落地；风险 4 承诺验签失败告警，实现只有 401 + 日志。

## Goals / Non-Goals

**Goals:**

- 单组件内存失控不拖垮同机其它容器。
- 企微配置类故障能被运维第一时间感知，且不制造告警风暴。

**Non-Goals:**

- 不引入 cgroup v2 之外的编排（不用 K8s/swarm）。
- 不做 CPU 硬限（4C8G 下 CPU 争抢影响远小于内存）。
- 不改动消息链路语义。

## Decisions

### D1 compose 用 `mem_limit`

Compose v2 非 swarm 场景支持服务级 `mem_limit`（底层 cgroup v1/v2 均可）。取值按概设 §10.1：

| 服务 | mem_limit |
|---|---|
| nginx | 128m |
| adapter | 512m |
| fastgpt | 2560m |
| mongo | 1024m |
| pg | 1229m |
| redis | 512m |

合计 ≈ 6.4G，符合 ≤6.5G 预算。`control-plane`（SaaS 叠加）512m。

> 备选 `deploy.resources.limits` 被否：在非 swarm 的 `docker compose` 下需要 `--compatibility` 才生效，容易漏配。

### D2 Redis maxmemory

`command: redis-server --appendonly yes --maxmemory 384mb --maxmemory-policy allkeys-lru --requirepass ${REDIS_PASSWORD:-}`。

- 容器限额 512m 留出 fork/碎片余量，`maxmemory` 384m 与概设一致。
- 上下文/去重允许丢（概设 §3.2 数据层说明），`allkeys-lru` 安全。

### D3 宿主内存校验

`install.sh --check` 增加：`MemTotal ≥ 7G`（4C8G 规格下留出系统开销），不足则 WARN（不阻断，允许 8G+ 机器）。

### D4 统一运维告警

新增 `apps/adapter/src/common/ops-alert.service.ts`：

```ts
class OpsAlertService {
  constructor(opts?: { cooldownMs?: number; now?: () => number; send?: (c: string) => Promise<boolean> })
  alert(key: string, content: string): Promise<boolean>  // 按 key 冷却
}
```

- 复用 `OPS_WEBHOOK_URL`（企微群机器人 text）；未配置 = 关闭；发送失败只 WARN。
- `LlmAlertService` 保留（有滑动窗口计数语义），`OpsAlertService` 面向单事件告警；两者不合并以免职责混杂。
- `WecomController` 验签失败分支调用 `alert('wecom-signature', ...)`，`await` 不阻塞响应（`void` + catch）。

### D5 文档

- 详设 §9.1：「令牌桶边界（第 20/21 次）」→「固定窗口边界（第 20/21 次）」；删除「3.5s 竞速分支」，注明群聊无被动回复。
- 概设 §10.1：镜像版本改为 nginx 1.27-alpine / mongo 7 / pgvector pg16，并注明「限额已在 `deploy/docker-compose.yml` 以 `mem_limit` 落地」。
- 部署手册补限额表与告警说明。

## Risks / Trade-offs

- [限额过紧导致 OOMKill] → adapter 512m 与概设一致，导入已按增量 200MB 守卫；fastgpt 2.5G 为其官方建议下限。
- [告警风暴] → 按 key 冷却（默认 30 分钟）。
- [`mem_limit` 在部分旧版 compose 被忽略] → `install.sh --check` 校验 `docker compose version ≥ 2.20`（已有）。

## Migration Plan

1. 发布后 `docker compose up -d` 会重建容器并应用限额；无需数据迁移。
2. 回滚：移除 `mem_limit` 行即可恢复原行为。

## Verification

- `docker compose config` 渲染出 6 个服务的 `mem_limit` 与 redis `maxmemory` 参数。
- `deploy-runtime.spec.ts` 断言限额存在且合计 ≤6.5G、redis 命令含 `maxmemory`。
- `ops-alert.spec.ts`：冷却期内只推一次、未配置/失败不抛。
- `wecom.controller.spec.ts`：验签失败仍 401 且触发一次告警。
- 全量单测/集成/验收通过。
