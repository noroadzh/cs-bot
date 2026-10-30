# 概设/详设完整性复核（第二十轮，2026-10-30，只读）

## 范围

基准：概设 V1.24、详设 V1.14。本轮核对 **平台控制面鉴权**（详设 §6.5）与 **运维访问审计/跳板**（概设 M11/§9/§12）。

## 结论

功能无缺口。发现 **2 处文档与实现不一致（P2）**。

## P2 文档不一致

### 1. 详设 §6.5 平台鉴权描述

- 文档：「鉴权 **mTLS** 或管理员 token + 双签机制」。
- 实际：`PlatformController` 使用 `AdminGuard`——**HTTP Basic Auth**（`ADMIN_USER`/`ADMIN_PASSWORD`，SHA-256 常量比对）+ `ALLOWED_ADMIN_IPS` CIDR 白名单；所有变更另经 `PlatformReasonGuard`（`reason` 必填，写入审计）；destroy 需 `approvals`（去重后 ≥2 人）与一次性 `confirmToken`。**未实现 mTLS**；`CONTROL_PLANE_TOKEN` Bearer 仅用于 `/platform/report`。
- 建议：§6.5 改为实际鉴权链（Basic + IP 白名单 + reason + 双签/令牌），并注明「远程访问建议叠加 `docker-compose.control-plane-expose.yml` 绑定管理网段」。

### 2. 「跳板入口」承诺

- 概设 M11：「运维访问审计：**跳板入口** + 每次进入实例记录（操作人/时间/租户/原因/时长）」；§9 安全设计、§12 风险 7 亦写「跳板访问」。
- 实际：产品只提供 `POST /platform/tenants/:id/shell-access`（记录 duration/reason/actor），**跳板本身由交付方运维体系提供**（堡垒机/SSH 网关），不在本期交付物内。
- 建议：文档注明「跳板由交付方运维侧提供（堡垒机/网关），产品负责调用 shell-access 记录审计并做链式留存」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| reason 必填 | `PlatformReasonGuard`，`/platform/report` 豁免 |
| 双签注销 | approvals 去重后 <2 拒绝 |
| 审计链 | seq + prev_hash + verify 接口 |
| 审计留存 | 180 天，清理前导出 JSONL |
| 控制面独立端口/DB | 3100 + `csbot_control`，默认不发布主机端口 |
