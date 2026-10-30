# 概设/详设完整性复核（第二十一轮，2026-10-30，只读）

## 范围

基准：概设 V1.25、详设 V1.15。本轮核对 **M11 租户注册表接口描述** 与 `tenant-registry` 规格的一致性。

## 结论

功能无缺口（规格层面 `GET /platform/tenants/:id` 已返回 quota + 当日用量，符合 `tenant-registry` 规格）。发现 **概设 M11 接口表 2 处描述超出实际、2 个已实现端点未列出（P2 文档）**。

## P2 概设 M11 接口表与实现不一致

| 文档 | 实际 |
|---|---|
| `GET /platform/tenants` → 「租户列表（状态/**配额**/订阅到期日/**用量摘要**）」 | 返回 `{total,limit,offset,rows}`：租户行（id/name/contact/status/host/port/expired_at…），**不含 quota/usage** |
| `GET /platform/tenants/:id` → 「租户详情（实例信息、**用量趋势**、订阅状态）」 | 返回 `{tenant, quota, usageToday}`（当日摘要，非趋势）；趋势需调区间接口 |
| —— | 缺 `GET /platform/tenants/:id/usage`（区间用量，供趋势） |
| —— | 缺 `POST /platform/tenants/:id/quota/consume`（原子消耗，计量/数据面调用） |

- 规格 `tenant-registry`「Tenant listing and detail」只要求详情含 quota 与当日用量摘要，实现已满足；列表的富字段是概设的额外承诺，未实现。
- 建议：修正表格为实际口径，并补两个已实现端点。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 列表分页 | 默认 50、上限 200、按 `created_at DESC`、`status` 过滤、`deleted_at IS NULL` |
| 详情 | tenant + quota + usageToday，符合规格 |
| 区间用量 | `/tenants/:id/usage` 返回按日序列 |
| 配额消耗 | `/tenants/:id/quota/consume` 原子 UPDATE + 429/404 语义 |
