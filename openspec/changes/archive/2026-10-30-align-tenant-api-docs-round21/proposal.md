# Proposal

## Why

第二十一轮复核发现概设 M11 接口表把 `GET /platform/tenants` 写成含「配额/用量摘要」、把详情写成含「用量趋势」——实际列表只返回租户行（规格只要求详情含 quota + 当日用量），趋势需走独立的 `/tenants/:id/usage`，且该端点与 `/quota/consume` 均未在表中列出。

## What Changes

- M11 接口表两行改为实际口径：
  - `GET /platform/tenants` → 租户列表（分页、`status` 过滤、按创建时间倒序）
  - `GET /platform/tenants/:id` → 租户详情（实例信息、配额、当日用量摘要）
- 补两行已实现端点：`GET /platform/tenants/:id/usage`（区间用量/趋势）、`POST /platform/tenants/:id/quota/consume`（原子消耗，429/404 语义）。
- 版本：概设 V1.26。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：概设 M11、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
