# Proposal

## Why

第十轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-10.md`）发现：上一轮为私有化部署新增 8443 FastGPT 管理口后，部署手册 §3/§5/§11 与概设 §9 仍写「仅 443 对外」。安全自查清单写错会让运维误判端口暴露面。另有 3 处接口/实现表述不一致（nginx 暴露路径、license 响应字段名、敏感词算法）。

## What Changes

- **端口基线统一**：部署手册 §3 端口矩阵、§5 准备清单、§11 安全自查，与概设 §9 端口基线改为「443 公网（限回调/运营网段）+ 8443 仅运维网段（默认 deny all）+ 22 白名单」。
- **概设 §9 传输安全**：改为「业务入口仅 `/wecom/callback`；另有 `/admin/*`（Basic Auth + IP 限制）与 `/healthz`」。
- **概设 M6**：「DFA 匹配」改为「Aho-Corasick 多模式匹配」。
- **详设 §6.4**：授权接口响应按实际 `LicenseState` 重写（`expiresAtMs`、`mock`、`currentUsage`）。
- 版本：概设 V1.16、详设 V1.9、部署手册 V1.12；交叉引用同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：部署手册、概设、详设、文档清单、用户手册与测试报告版本引用。
- **代码/规格/测试**：无改动。
