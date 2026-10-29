# Proposal

## Why

第五轮完整性复核（`openspec/explorations/2026-10-29-design-completeness-recheck-5.md`）发现：`GET /admin/miss-records?format=json` 直接返回数据库原始行，`userid` 未脱敏，且响应结构与主规格不符（`rows` 而非 `items`，字段未投影）。这与 `miss-record` 规格「两种格式都必须掩码 userid」的明文要求冲突，属隐私缺陷。

## What Changes

- **BREAKING（仅管理面 JSON 导出结构）**：JSON 响应由 `{total, rows}` 改为规格定义的 `{total, items:[{question, chatId, score, mediaType, status, createdAt}]}`，`userid` 不再出现在响应中（原字段本应掩码）；`traceId`/`engine`/`createdAt` 按规格取舍。
- 掩码统一复用 `maskPII(value, 'userid')`，与 xlsx 导出保持一致。
- 补测试：JSON 导出断言 `items` 结构、`userId` 已掩码（或按规格不含原始值）、无原始 `user_id`。
- 详设 §2.1 `HttpClient` 段落改为实际形态（各客户端直连 axios + 公共 Semaphore），与本变更一并提交。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `miss-record`：JSON 导出的响应字段与掩码要求显式化（原规格已要求掩码，本次补齐结构与验收场景）。

## Impact

- **API**：`GET /admin/miss-records?format=json` 响应结构由 `rows` 改为 `items`，字段集合收窄（管理面内部接口，手册同步）。
- **代码**：`apps/adapter/src/admin/miss.controller.ts`、`apps/adapter/src/miss/miss-export.service.ts`（新增投影/掩码函数）。
- **测试**：`apps/adapter/test/miss.controller.spec.ts`、`miss-export.service.spec.ts`。
- **文档**：详设 §2.1 与 §6.1、部署手册未命中导出示例、用户手册（私有化版未命中章节）。
