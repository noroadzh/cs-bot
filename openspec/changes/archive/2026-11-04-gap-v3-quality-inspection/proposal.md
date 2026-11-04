## Why

`POST /admin/archive/quality-check` 仅瞬时返回 alerts，无持久审计与节流告警闭环，运营无法回溯与排障。需把在线质检做到可验收。

## What Changes

- 持久化质检样本（规则结果、阈值、时间窗）
- 超阈触发 ops webhook，按 `(rule, window)` 冷却去重
- 查询 API + admin-web `/quality` 页
- 与会话存档 ingest 解耦（ingest 仍属 import/archive）

## Capabilities

### New Capabilities

- `quality-inspection`: 在线质检持久化、告警与查询

### Modified Capabilities

- `import-pipeline`: Session archive 质检 Scenario 改为引用 durable quality（不再仅瞬时 alerts）
- `admin-console`: 新增 Quality 运营页

## Impact

- 代码：新建 `quality/`（或 `archive/quality-*`）、迁移 SQL、Ops 告警复用现有 webhook 模式
- API：`GET /admin/archive/quality-inspections`；扩展 `POST .../quality-check` 返回 `inspectionId`
- 非目标：单进程多租户 ALS、用户表 RBAC、k8s GPU、LoRA 训练执行器
