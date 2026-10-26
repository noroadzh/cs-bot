# Tasks

## 1. 日志基础设施

- [x] 1.1 `common/logger.ts` 建 pino root 单例：base(app/version/env/pid)、level label、ISO 时间戳、`redact` 路径脱敏、`LOG_FILE` 时 multistream 双写
- [x] 1.2 新增 `common/request-context.ts`：`AsyncLocalStorage<{traceId}>`、`hashId()/truncate()` 工具
- [x] 1.3 `AppLogger` 读取 ALS 自动附加 `traceId`（非请求上下文不附加）

## 2. 请求与异常

- [x] 2.1 HTTP 访问日志中间件（pino-http 或等价）：method/url/status/costMs/remoteIp/ua；healthz 降级；敏感 query 脱敏
- [x] 2.2 全局异常过滤器 `AllExceptionsFilter`（`APP_FILTER`）：HttpException→warn 保持原响应；其他→error(含 stack)+500 统一体
- [x] 2.3 响应头回写 `X-Request-Id`（=traceId）

## 3. 关键链路埋点

- [x] 3.1 QA：上下文读取、引擎调用（engine/source/costMs/score/tokens）、置信度、过滤命中、发送（段数/失败）
- [x] 3.2 routing：trigger 判定、dedup 命中、限流命中
- [x] 3.3 import：job 生命周期（uploaded→parsing→cleaned→paired→confirm→imported/rollback/retry）与失败原因
- [x] 3.4 platform：tenant create/provision/quota/upgrade/monitor/sweep/offboard 入参摘要与结果/耗时
- [x] 3.5 license：校验结果、受限模式、到期告警
- [x] 3.6 外部依赖：DB/Redis/FastGPT/WeCom/LLM 失败 errCode+endpoint+costMs；超 SLOW_LOG_MS 记 slow
- [x] 3.7 miss/media/usage 补点（导出/识别/上报失败）

## 4. 脱敏与安全

- [x] 4.1 `redact` 路径覆盖 authorization/password/secret/token/licenseKey；正文/answer 只记 hash/长度/截断
- [x] 4.2 启动配置摘要与 `config-check` 只输出存在性（脱敏）

## 5. 落盘与运维

- [x] 5.1 `LOG_FILE` 双写 + `deploy/logrotate.conf`（按天/大小轮转、保留期）
- [x] 5.2 部署手册：`docker logs` 与挂载日志文件排查指引、级别/慢日志配置

## 6. 生命周期与进程级

- [x] 6.1 启动阶段日志（config/license/redis/pg/listen + 版本）、SIGTERM 优雅关闭日志
- [x] 6.2 `uncaughtException`/`unhandledRejection` 记 fatal（不静默退出）

## 7. 测试与验证

- [x] 7.1 单测：异常过滤器（HttpException/未知/不泄露 stack）、trace 贯穿、redact、慢日志、healthz 采样
- [x] 7.2 既有全套 jest 通过；`openspec validate add-operational-logging --strict` 通过
