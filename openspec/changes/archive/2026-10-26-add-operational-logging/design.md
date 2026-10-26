# Design: add-operational-logging

## Context

生产服务器无法 SSH，只能打包发布；线上问题只能靠日志定位。现有 `AppLogger`（pino 结构化封装）覆盖 22 个模块，但缺少 HTTP 访问日志、全局异常捕获、请求级 trace 贯穿、落盘/轮转与关键链路系统性埋点。本 change 在**不改变业务行为**的前提下补齐可观测性。

## Goals / Non-Goals

**Goals:**
- 每条日志单行 JSON，请求内自动携带 `traceId`。
- 覆盖 HTTP 访问、未处理异常、QA/控制面/外部依赖关键节点。
- 脱敏、级别可调、慢日志、落盘轮转。
- 无 SSH 时通过 `docker logs` 或挂载文件即可定位。

**Non-Goals:**
- 不接入 ELK/Loki/APM，不做 OpenTelemetry 分布式追踪。
- 不改变既有错误码与响应契约语义。

## Decisions

### D1: 日志库与 root
沿用 pino。`common/logger.ts` 建 root 单例：`base: {app, version, env, pid}`；`formatters.level → label`；ISO 时间戳；`redact` 路径脱敏；输出 stdout，若 `LOG_FILE` 设则 `pino.multistream` 双写（stdout + 文件）。

### D2: 请求上下文（traceId）
`common/request-context.ts` 用 `AsyncLocalStorage<{ traceId }>`。HTTP 中间件从 `x-request-id` 或 wecom `traceId` 取，否则 `randomUUID`，在 `run(store)` 内处理请求；`AppLogger` 读取 ALS 自动附加 `traceId`。非 HTTP（cron/sweep）自行生成并 `run`。

### D3: HTTP 访问日志
接入 `pino-http`（或等价 Nest middleware）：记录 method/url/status/costMs/remoteIp/ua；`/healthz` 采样或降级到 debug；敏感 query（token/secret）脱敏。

### D4: 全局异常过滤器
`APP_FILTER`（`AllExceptionsFilter`）：HttpException → 记 warn（errCode/status/context）并保持原响应；其他 Error → 记 error（含 stack），返回 500 统一体 `{errCode: 'INTERNAL_ERROR'}`，不泄露 stack；附 traceId/path/method。

### D5: 脱敏与安全
`redact` 路径覆盖 `req.headers.authorization`、`*.password/secret/token/licenseKey`；日志不记完整正文/answer，只记 `userIdHash`/长度/截断；提供 `hashId()`/`truncate()` 工具；`config-check` 与启动摘要只输出存在性。

### D6: 落盘与轮转
默认 stdout（`docker logs`）；`LOG_FILE` 设则文件 sink；`deploy/logrotate.conf` 覆盖按天/大小轮转与保留期；启动日志打印 version/env/关键配置摘要（脱敏）。

### D7: 级别与慢日志
`LOG_LEVEL` 控制级别；`SLOW_LOG_MS` 阈值：请求或外部调用超阈值记 `slow` 日志（costMs/target）。

### D8: 生命周期与进程级
启动阶段日志（config/license/redis/pg/listen）+ 版本；SIGTERM 优雅关闭日志；`process.on('uncaughtException'/'unhandledRejection')` 记 fatal（不静默退出）。

### D9: 响应头 X-Request-Id
在响应中回写 `X-Request-Id`（=traceId），便于用户/前端报障时提供定位标识。

## Risks / Trade-offs

- [R1 日志量] → healthz 采样/降级；`LOG_LEVEL` 可调。
- [R2 敏感泄露] → redact + 主动脱敏 + 单测覆盖。
- [R3 性能] → pino 异步写入；热路径避免拼大对象。
- [R4 响应契约] → 异常过滤器保持状态码/errCode 语义，仅统一体与补字段。

## Migration Plan

1. 基础设施：logger root / ALS / filter / middleware。
2. 逐模块埋点（qa/routing/import/platform/license/media/miss/usage/wecom）。
3. 落盘/轮转 + 手册。
4. 回滚：默认 `LOG_LEVEL=info`，新日志为增量，关闭不影响业务；异常过滤器可临时移除 APP_FILTER。

## Open Questions

- 是否对 `/healthz` 采用固定采样率而非完全降级（多数探针 10s 一次，降级到 debug 即可）。
- `LOG_FILE` 默认关闭还是默认启用（建议默认关闭，stdout 交给 docker 日志驱动）。
