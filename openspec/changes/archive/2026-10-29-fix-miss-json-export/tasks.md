# Tasks

- [x] 1.1 `MissExportService.queryItems`：投影 + `maskPII(userId,'userid')`，不含 trace_id/engine。
- [x] 1.2 `MissController` JSON 分支返回 `{total, items}`。
- [x] 1.3 更新 `miss.controller.spec`、`miss-export.service.spec`，新增「不泄露原始标识」断言。
- [x] 2.1 详设 §2.1 HttpClient 改为实际形态、§6.1 补 JSON 结构。
- [x] 2.2 部署手册与私有化用户手册的未命中导出示例同步。
- [x] 3.1 全量单测、集成、验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify fix-miss-json-export`，通过后 `/opsx:archive`。
