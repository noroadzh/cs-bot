# Design

## Context

P0 为避免稀释全局，暂时排除三文件。现有 spec 已较全（engine/import-job）或部分（platform.controller），缺口主要在分支与未测控制器动作。

## Decisions

1. **一次拉回三文件**（方案 A），设单文件阈值：行/语句/函数 ≥60%，分支 ≥50%。
2. **只补关键分支**；不刷 DTO；不降管道/全局棘轮。
3. **qa 目录阈值不变**（行 ≥80% / 分支 ≥70%）；收 `fastgpt-qa.engine` 后若拖低 qa 分支，优先补引擎测而非降目录阈值。
4. 全局仍由 `check-coverage-global.mjs` 校验。

## Risks

- `platform.controller` 面大 → 聚焦开通/配额/销毁/升级/导出等高风险动作。
- WSL/D: exceljs 慢 → 保持 180s timeout；import-job 覆盖以既有 stub 测为主。
