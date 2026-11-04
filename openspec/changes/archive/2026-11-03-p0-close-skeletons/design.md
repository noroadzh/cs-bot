# Design

## Context

P0 实现已完成；本 change 是**规格回填与归档**，使主规格与可验收行为一致。权威实现见代码与 `.cursor/plan/p0-close-skeletons.md`。

## Goals / Non-Goals

**Goals**

- 主规格明确：存档→import、tenant 隔离、ModelRouter 热路径、billing_order 持久化
- 与 absorb-phase2 ADDED 无冲突：本 change 只 MODIFIED 收紧场景

**Non-Goals**

- 企微会话存档开放平台 SDK / 定时拉取
- 微信、支付宝正式 SDK
- 单进程内按请求切换 `tenant_id`（ALS）
- GPU 调度与 Prometheus

## Decisions

1. **实例级 TENANT_ID**：数据面用 env `TENANT_ID` 盖章与过滤；Redis `t:{id}:` 前缀；空租户保持兼容私有化。
2. **存档入口**：`POST /admin/archive/ingest` → `ImportJobService.createFromFile`（JSON wecom-archive）；不在 ingest 同步 parse（R-8）。
3. **路由挂点**：注入 `FastGPTQaEngine`（非改 orchestrator 入站）；目录空则沿用原 FastGPT/`MODEL_MODE` 链。
4. **计费**：控制面 `billing_order` 表；`channel=mock` 为沙箱；`markPaid` → `TenantService.renew` + `platform_audit_log`。

## Risks / Trade-offs

- absorb 未 sync 时主规格缺 ADDED：归档顺序必须先 absorb sync，再本 change sync。
- 真实支付与存档 SDK 仍属 P1，对外勿宣称全量支付/存档拉取已生产。

## Migration Plan

无运行时回滚步骤；规格侧：sync → archive。DB 列已有 `DEFAULT ''`，旧行视为未绑定租户。
