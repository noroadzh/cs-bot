# 概设/详设完整性复核（第十二轮，2026-10-30，只读）

## 范围

基准：概设 V1.17、详设 V1.10。本轮核对**详设 §1 工程组织（仓库结构/模块划分/依赖强制）**与**§9 测试设计**。

## 结论

功能无缺口。本轮发现 **2 处结构描述过时（P1）** 与 **2 处工程/测试表述与仓库现状不符（P2）**，均为文档问题。

## P1 结构描述过时

### 1. §1.1 写有独立 `apps/control-plane/` 应用

- 文档仓库树：`apps/adapter/` 与 `apps/control-plane/` 两个应用。
- 实际：仓库仅 `apps/adapter`；控制面是 `apps/adapter/src/control-plane/` 模块 + 独立入口 `apps/adapter/src/control-plane-main.ts`，与数据面**共用同一镜像**、独立端口/数据库/鉴权（`control-plane-main.ts` 注释已说明）。
- 建议：仓库树改为 `apps/adapter/`（含 `control-plane/` 子模块与 `control-plane-main.ts`），并注明「同镜像双入口」。

### 2. §1.2 模块映射与实际目录不一致

| 文档 | 实际 |
|---|---|
| `orchestration/ (M4)` | `qa/`（QaOrchestrator、FastGPTClient、引擎） |
| `report/ (D10)` | `usage/`（UsageService/Reporter/Capacity*/Guard） |
| `config/ (M7)` 含 HealthController | `health/` 独立目录 |
| —— | 缺 `admin/`、`common/`、`internal/`、`control-plane/`、`platform/`、`types/` |

建议按实际目录重写映射表。

## P2 表述与现状不符

### 3. §1.2 声称依赖方向由 ESLint `nx/enforce-module-boundaries` 强制

- 仓库根、`apps/adapter`、`packages/*` 均无 ESLint 配置（无 `.eslintrc*`/`eslint.config.*`），`package.json` 无 `lint` 脚本。
- R-1~R-8 目前靠评审与模块结构约束，非工具强制。
- 建议：改为「依赖方向由模块划分与代码评审保证；lint 边界规则待补（可选）」；或后续真正引入 ESLint。

### 4. §9.2 写「集成测试（docker compose 起 6 容器）」

- 实际 `test/integration` 使用真实 PG（`TEST_PG_URL`）+ 内存/假实现（InMemoryDatasetClient、假 docker/cert/授权），不启动 6 容器。
- 真实 6 容器冒烟是可选脚本 `scripts/acceptance-real.sh`（`REAL_COMPOSE=1` 才执行，默认 skip）。
- 建议：§9.2 拆成「集成测试（真实 PG + 假外部依赖）」与「真实 6 容器冒烟（可选脚本）」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 覆盖率门槛 | jest.config 全局 75%、管道模块 80%、横切 60%，与 §9.1 一致 |
| 分层约定 | Controller→Service→Client/Repository 普遍遵守 |
| monorepo 结构 | pnpm workspace：apps/adapter + packages/shared + packages/license-native + deploy + tools |
| 测试矩阵 | 单测 106 套件 / 985 用例；集成 7/28；验收 6/23 |
