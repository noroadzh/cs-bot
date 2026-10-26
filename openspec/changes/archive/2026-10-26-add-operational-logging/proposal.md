# Proposal: add-operational-logging

## Why

生产服务器无法 SSH 登录，只能打包发布；线上问题只能靠日志定位。当前虽有 `AppLogger`（pino 结构化封装），但缺少 **HTTP 访问日志、全局异常捕获、请求级 traceId 贯穿、日志落盘/轮转、以及关键链路（wecom 回调 / QA / 导入 / 控制面）的系统性埋点**，一旦线上出问题（回调失败、问答超时、租户编排失败等），现有日志不足以还原现场。

## What Changes

- **统一日志基础设施**：pino root 补充基础字段（app/version/env/pid/host）、JSON 输出、`redact` 脱敏、时间戳与级别标签；新增 `LOG_FILE`/`LOG_HTTP`/`SLOW_LOG_MS` 等配置。
- **HTTP 访问日志**：接入 `pino-http`，为每个请求生成/透传 `requestId`(=traceId)，记录方法/路径/状态码/耗时/远端 IP/UA/关键 query，覆盖 `/wecom/*`、`/admin/*`、`/platform/*`、`/healthz`。
- **全局异常过滤器**：注册 `APP_FILTER`，捕获未处理异常与 HttpException，统一记录 `errCode/message/stack/上下文`，返回一致的错误响应体（不向外泄露堆栈）。
- **请求级 trace 贯穿**：用 `AsyncLocalStorage` 承载 `traceId`，`AppLogger` 自动附加；wecom 现有 traceId 复用，admin/platform 由中间件生成。
- **关键链路埋点补齐**：
  - QA：上下文读取、引擎调用（engine/source/costMs/score/tokens）、置信度判定、过滤命中、分段发送（段数/字节/失败）；
  - 路由：trigger 判定、dedup 命中、限流命中；
  - 导入：job 生命周期（uploaded→parsing→cleaned→paired→confirm→imported/rollback/retry）与失败原因；
  - 控制面：tenant create/provision/quota/upgrade/monitor/sweep/offboard 的入参摘要与结果；
  - license：校验结果、受限模式、到期告警；
  - 外部依赖：DB/Redis/FastGPT/WeCom/LLM 失败的 errCode + 耗时。
- **脱敏与安全**：日志统一 `redact`（正文/answer/密钥/token/手机号/身份证等），只记 hash/长度/截断；禁止打印 `.env` 与授权私钥。
- **落盘与轮转**：默认输出 stdout（`docker logs` 可查），可选 `LOG_FILE` 落盘并经 `logrotate` 轮转；启动日志打印构建版本/commit/env/关键配置摘要（脱敏）。
- **生命周期**：启动各阶段、SIGTERM 优雅关闭、未捕获异常/未处理 Promise rejection 的进程级捕获日志。
- **级别与慢日志**：`LOG_LEVEL` 运行级别；超过 `SLOW_LOG_MS` 的请求/外部调用记 `slow` 日志（便于线上抓性能问题）。

## Capabilities

### New Capabilities
- `observability-logging`: 结构化日志、HTTP 访问日志、全局异常捕获、请求级 trace 贯穿、脱敏、落盘/轮转、级别与慢日志。

### Modified Capabilities
- `deployment-suite`: 日志落盘目录、`logrotate` 规则、`docker logs` 排查说明与启动配置摘要。

## Impact

- **代码**：
  - `apps/adapter/src/common/logger.ts`（root/redact/ALS 绑定）
  - 新增 `apps/adapter/src/common/request-context.ts`（AsyncLocalStorage）
  - 新增 `apps/adapter/src/common/http-logging.middleware.ts`（pino-http）
  - 新增 `apps/adapter/src/common/all-exceptions.filter.ts`（APP_FILTER）
  - `apps/adapter/src/main.ts`（中间件/过滤器注册、生命周期日志、进程级 handler）
  - `apps/adapter/src/app.module.ts`（全局 filter/middleware 装配）
  - 各 service/controller 埋点补齐（qa/routing/import/platform/license/wecom/miss/media/usage）
- **依赖**：新增 `pino-http`（pino 已有）。
- **配置**：`LOG_LEVEL`、`LOG_FILE`、`LOG_HTTP`、`SLOW_LOG_MS`、`LOG_PRETTY`。
- **部署**：`deploy/logrotate.conf` 补充、日志目录、`docker logs` 与落盘日志排查指引。
- **兼容**：日志为新增，不改变业务行为；错误响应体统一需与既有 admin/platform 契约保持一致（HTTP 状态码与 errCode 不变，仅补字段）。

## Non-Goals

- 不接入集中式日志平台（ELK/Loki）或 APM；不做分布式追踪（OpenTelemetry）。
- 不做日志内容的业务级审计（审计链由 `platform-audit` 负责）。
- 不改变既有错误码与响应契约语义。
