# Proposal

## Why

MVP 基线（cs-bot-mvp-foundation）已归档，11 个能力的生产代码全部落地并通过编译。但原任务组 13-14（单元测试 + 端到端冒烟）当时只留了 9 个测试文件的骨架，合计 296 行，未实际跑通、未覆盖全部管道模块、未配置 jest 基建。回归安全网缺失，后续任何改动（尤其 FastGPT 真实对接与 Rust 授权模块注入）都无法验证不破坏现有行为。本 change 补齐测试基建与全部单元测试，使 CI 可用覆盖率门禁约束管道模块。

## What Changes

- 新增 `unit-testing` 能力：定义单测基建（jest/ts-jest/ESM 映射）、mock 策略（Redis/PG/axios 全部 stub、不依赖 docker compose）、各管道模块的必测行为清单（wecom-crypto 验签/加解密、trigger 短路顺序、dedup 幂等、rate-limiter 双层限流、context 截断与 fail-open、filter 命中与热加载、mock-qa 匹配与兜底、license 三态、admin 鉴权、qa-orchestrator 分段与素材提取）。
- 新增 `pipeline-smoke` 能力：定义进程级冒烟契约——`USE_MOCK_LLM=true` 启动 adapter（不依赖外部 Redis/PG 时依赖探活降级为警告）、对 `/healthz` 与 `/admin/*` 的 HTTP 冒烟断言、`pnpm -C apps/adapter test` 与 `build` 必须全绿的退出码契约。
- 修复既有 9 个测试骨架中不可运行的用例（错误 mock 路径、`ConfigService.instance` 未初始化、jest ESM 配置与 ts-jest 不匹配等），使 `pnpm test` 首次真实可执行。
- 覆盖率门禁生效：管道模块（wecom/routing/context/qa/filter/miss/media）行覆盖 ≥80%，横切模块（config/license/admin/health/common）≥60%，全局 ≥60%。

## Capabilities

### New Capabilities

- `unit-testing`: 单元测试基建与必测行为契约（jest 配置、mock 原则、各服务必测场景、覆盖率门禁）。
- `pipeline-smoke`: mock 模式端到端冒烟契约（启动、健康检查、管理面鉴权冒烟、测试命令退出码）。

### Modified Capabilities

（无——本 change 只补测试，不改变任何已归档能力的运行时需求。）

## Impact

- 代码：`apps/adapter/test/**`（重写 9 个骨架 + 新增 qa-orchestrator、config.service、miss、routing.service、wecom-client 测试）；`apps/adapter/jest.config.cjs`（修正 ESM/transform 映射）；`apps/adapter/package.json`（test 脚本）。
- 依赖：无新增运行时依赖；devDependencies 已含 jest/ts-jest/@types/jest。
- 不影响：生产代码行为、部署套件、已归档的 11 个能力 spec。
- 验证入口：`pnpm -C apps/adapter test`、`pnpm -C apps/adapter test:cov`、`pnpm -C apps/adapter build`。
