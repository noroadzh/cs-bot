## Context

`ArchiveService` / quality-check 现为瞬时计算；缺少表与告警冷却。

## Goals / Non-Goals

**Goals:** 持久化样本、冷却告警、查询 API、`/quality` 页。  
**Non-Goals:** ALS 多租户、用户表 RBAC、改 import 8 步算法。

## Decisions

1. 新表 `quality_inspection`（miss 或 archive 模块 SQL，三位序号）。
2. 告警复用现有 ops webhook + cooldown key 模式（对齐企微验签告警）。
3. 兼容扩展 `POST /admin/archive/quality-check`，加 `inspectionId`。

## Risks / Trade-offs

- 阈值配置错误导致告警风暴 → 强制 cooldown。
- 内容泄露 → 禁止落库原文。

## Migration Plan

迁移 SQL + 默认关闭 webhook；有 `OPS_WEBHOOK_URL` 才发。
