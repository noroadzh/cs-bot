# Proposal

## Why

第二十轮复核发现详设 §6.5 把平台鉴权写成「mTLS 或管理员 token」，实际是 Basic Auth + IP 白名单 + reason 守卫 + 双签令牌，未实现 mTLS；概设 M11/§9/§12 多处承诺「跳板入口」，但产品只提供 shell 访问审计记录接口，跳板由交付方运维体系提供。

## What Changes

- 详设 §6.5：改为实际鉴权链——Basic Auth（`ADMIN_USER`/`ADMIN_PASSWORD`）+ `ALLOWED_ADMIN_IPS` CIDR + `PlatformReasonGuard`（reason 必填并写审计）+ destroy 双签（`approvals` 去重 ≥2）与一次性 `confirmToken`；注明远程访问用 `control-plane-expose` 叠加并绑定管理网段；`CONTROL_PLANE_TOKEN` Bearer 仅用于 `/platform/report`。
- 概设 M11/§9/§12：明确「跳板由交付方运维侧提供（堡垒机/网关），产品通过 `/platform/tenants/:id/shell-access` 记录审计并链式留存」。
- 版本：概设 V1.25、详设 V1.15。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：概要设计、详细设计、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
