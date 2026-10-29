# Proposal

## Why

第四轮完整性复核（`openspec/explorations/2026-10-29-design-completeness-recheck-4.md`）确认功能全部完成，但概设/详设仍有 4 处实现细节描述与实际不一致（编排渲染方式、解析器数量、限流窗口、素材标记格式）。这些不影响运行与外部契约，但会让后续维护按错误描述排查。

## What Changes

- 详设 §3.10：把 `env.hbs` + `compose.overrides.hbs` 改为 `ShellProvisioner.render()` 内联生成 compose，并修正端口/项目/网络/库名描述。
- 详设 §3.9：解析器由“三种实现”改为实际的 CSV/JSONL/TXT/XLSX 四种（`csvParser`/`jsonlParser`/`txtParser`/`xlsxParser`）。
- 概设 M2：限流由“滑动窗口”改为按分钟固定窗口（INCR+EXPIRE）。
- 概设 M8：素材标记由 `[[素材:(\d+)]]` 改为 UUID 形式 `[[素材:<uuid>]]`。
- 概设版本补 V1.11、详设版本补 V1.3。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档细节对齐，行为不变，`skip_specs: true`。）

## Impact

- **文档**：`docs/02-需求与设计/概要设计-微信群智能客服机器人MVP.md`、`docs/02-需求与设计/详细设计-微信群智能客服机器人MVP.md`。
- **代码/规格/测试**：无改动。
