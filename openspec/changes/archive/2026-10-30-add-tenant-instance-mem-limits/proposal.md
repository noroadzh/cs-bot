# Proposal

## Why

第十四轮复核发现：概设 §10.5 与 §12 风险 8 承诺 SaaS 每租户实例「用 cgroup 限额硬隔离」，但 `shell-provisioner` 渲染的租户 compose 六个服务都没有 `mem_limit`——多租户同机时任一实例内存增长会挤占其它租户，硬隔离承诺未落地（基线私有化 compose 已有 mem_limit，租户模板漏了）。

## What Changes

- `ShellProvisioner.render()` 为租户 compose 的六个服务加 `mem_limit`（standard 档 = 私有化基线：nginx 128M / adapter 512M / fastgpt 2.5G / pg 1.2G / mongo 1G / redis 512M），并在文件头注明档位来源。
- 补测试：渲染产物含 6 个 `mem_limit` 且合计 ≤ 6.5G。
- 文档：概设 §10.5 注明「租户 compose 已按 standard 档写入 mem_limit」；§12 风险 8 措辞与新实现一致。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `tenant-provisioning`：新增「租户实例资源硬限额」要求。

## Impact

- **代码**：`apps/adapter/src/platform/provisioner/shell-provisioner.ts`。
- **测试**：`shell-provisioner.spec.ts` 断言限额。
- **文档**：概设 §10.5/§12。
