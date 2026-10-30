# Proposal

## Why

第十二轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-12.md`）发现详设 §1 工程组织描述过时：仓库树画了不存在的 `apps/control-plane/`；§1.2 模块映射仍写 `orchestration/`、`report/`，且声称依赖方向由 ESLint 强制（仓库无 ESLint）；§9.2 把集成测试写成「docker compose 起 6 容器」，实际是真实 PG + 假外部依赖，真实 6 容器冒烟是可选脚本。

## What Changes

- **§1.1 仓库结构**：改为实际形态——`apps/adapter`（含 `control-plane/` 子模块与 `control-plane-main.ts`，同镜像双入口），保留 packages/deploy/tools。
- **§1.2 模块映射**：按实际目录重写（`qa/`、`usage/`、`health/` 独立，补 `admin/common/internal/control-plane/platform/types`）。
- **§1.2 依赖强制**：改为「由模块划分与代码评审保证；ESLint 边界规则待补」。
- **§9.2 测试设计**：拆为「集成测试（真实 PG + 假外部依赖）」与「真实 6 容器冒烟（`scripts/acceptance-real.sh`，`REAL_COMPOSE=1`）」。
- 版本：详设 V1.11；文档清单与交叉引用同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：详设、概设引用、文档清单、用户手册与测试报告版本引用。
- **代码/规格/测试**：无改动。
