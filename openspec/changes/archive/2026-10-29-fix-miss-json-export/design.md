# Design

## Context

见 proposal.md。`MissController.list` 的 JSON 分支直接 `res.json({total, rows})` 透出 `queryRecords()` 的原始行；xlsx 分支已通过 `maskPII(..., 'userid')` 掩码。规格要求两种格式都掩码 `userid`，且 JSON 结构为 `items`。

## Goals / Non-Goals

**Goals:**

- JSON 导出不再泄露原始 `user_id`/`trace_id`/`engine`。
- 响应结构与主规格一致，管理面契约可预期。

**Non-Goals:**

- 不改 xlsx 导出（已合规）。
- 不改查询 SQL 与保留期清理。
- 不新增分页（沿用现有 `EXPORT_LIMIT`）。

## Decisions

### D1 投影在导出服务层完成

新增 `MissExportService.queryItems(days, range)`：复用现有 `queryRecords`，把每行映射为 `{question, chatId, score, mediaType, status, createdAt, userId: maskPII(userId, 'userid')}`。

- 放服务层而非 controller：与 xlsx 掩码同源，便于单测，controller 只负责组装 envelope。
- `userId` 保留但掩码：统一使用共享 `maskPII`（首 2 + `***` + 末 2，与 xlsx 导出、config-check 同源），`wxid_abcdefg123` → `wx***23`。不引入第二套掩码实现。

### D2 移除原始标识

`trace_id` 与 `engine` 不进入 JSON 投影：规格列出的 `items` 字段不含它们，且 trace_id 可关联内部日志，管理面导出无需暴露。

### D3 响应结构

`{ total: items.length, items }`。此前是 `{total, rows}`，属管理面内部结构调整，用户手册与部署手册示例同步。

### D4 文档对齐（同批提交）

详设 §2.1 `HttpClient` 改为实际形态：各客户端（WecomClient/FastGPT 引擎/VL）直连 `axios.create` + 重试内建，并发由 `common/semaphore.ts` 统一提供（`LLM_CONCURRENCY=4` / `WECOM_CONCURRENCY=8` / `VL_CONCURRENCY=2`）；不再声称存在统一 `HttpClient.request`。§6.1 补 JSON 结构。

## Risks / Trade-offs

- [调用方依赖 `rows`] → 控制台/手册示例同步；内部接口，无外部客户端承诺。
- [字段收窄导致信息不足] → traceId 可在 adapter 日志用 `X-Request-Id` 检索；确需排查时由运维查库。

## Migration Plan

1. 发布控制面/数据面同一镜像，JSON 导出结构立即生效。
2. 回滚：恢复上一镜像；无数据库变更。

## Verification

- 单测：JSON 导出断言 `items` 结构、`userId` 掩码、响应体不含 `trace_id`/`engine`/原始 userid。
- 既有 `miss.controller.spec` / `miss-export.service.spec` 更新为新结构。
- 全量单测、集成、验收通过。
