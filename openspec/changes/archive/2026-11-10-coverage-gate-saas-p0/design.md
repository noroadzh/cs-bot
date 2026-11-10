# Design

## Context

- 现门禁只收 wecom/routing/context/qa/filter/miss/media + config/license/admin/health/common
- `platform`/`import`/`usage` 已有不少 spec，但无阈值；导入锁、usage webhook 缺直接单测

## Decisions

1. **P0 关键路径文件入门禁**，非整目录 `platform/**`（避免稀释全局分支）。
2. **路径级阈值在 jest；全局用 `check-coverage-global.mjs`**（Jest 在 global+路径并存时算偏）。
3. **棘轮**：全局行/语句 ≥75%、分支 ≥60%、函数 ≥70%；管道行/语句/函数 ≥80%、分支 ≥70%；横切 ≥60%；P0 单文件见 jest 配置。
4. **离线 stub**：pg / axios 全 mock；不连真实 Docker/企微。
5. **不改生产行为**：本 change 只加测试与门禁（外加支撑门禁可跑的 DI/timeout 修复）。

## Risks

- 慢盘（WSL/D:）上 exceljs 单测可达 2min+ → `testTimeout: 180_000`。
- 被排除的大面文件（如 `fastgpt-qa.engine`、`import-job.service`）需后续补测后再移回 collect。
