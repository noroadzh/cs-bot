# Spec Delta

## Purpose

定义 cs-bot adapter 在 mock 模式下的端到端冒烟契约，确保构建产物可启动、HTTP 路由可访问、管理面鉴权可工作。

## ADDED Requirements

### Requirement: 测试与构建命令退出码

`pnpm -C packages/shared build`、`pnpm -C apps/adapter build`、`pnpm -C apps/adapter test` 三条命令 MUST 在干净工作区退出码为 0。`pnpm -C apps/adapter test:cov` 在所有必测场景被覆盖时退出码为 0。

#### Scenario: 全量构建绿
- **WHEN** 在仓库根目录执行 `pnpm install && pnpm -r build`
- **THEN** shared 与 adapter 均编译成功，stdout 不出现 `error TS` 行，进程退出码 0

#### Scenario: 全量测试绿
- **WHEN** 执行 `pnpm -C apps/adapter test`
- **THEN** jest 报告 `Tests: X passed, Y skipped`，进程退出码 0

### Requirement: 端到端冒烟脚本

`apps/adapter/test/smoke.spec.ts` MUST 通过 `supertest` 或同等机制对 NestJS 应用直接发起 HTTP 请求，验证 `/healthz` 与 `/admin/license` 两条路由的鉴权前/后行为。测试 MUST 不依赖真实 Redis/PG（已在 setup 阶段以 jest.mock 替换）。

#### Scenario: 未鉴权访问管理面
- **WHEN** 无 Authorization 头请求 `/admin/license`
- **THEN** 响应状态码 401，body.errCode 为 `AUTH_UNAUTHORIZED`

#### Scenario: 鉴权后访问管理面
- **WHEN** 携带正确 Basic Auth 请求 `/admin/license`
- **THEN** 响应状态码 200，body.valid 为 true，body.mock 为 true

#### Scenario: 健康检查
- **WHEN** 请求 `/healthz`
- **THEN** 在 Redis/PG 已 mock 场景下响应 200，body.status 为 `ok`

### Requirement: 不依赖 Docker 的开发期冒烟

开发者 MUST 可在 macOS/Linux 终端直接跑测试与构建，无需先启动 docker compose。依赖外部服务的测试 MUST 用 jest.mock 隔离。

#### Scenario: 无 docker 环境跑测试
- **WHEN** 终端 `docker ps` 报 `Cannot connect to the Docker daemon` 后执行 `pnpm -C apps/adapter test`
- **THEN** 全部测试通过，进程退出码 0
