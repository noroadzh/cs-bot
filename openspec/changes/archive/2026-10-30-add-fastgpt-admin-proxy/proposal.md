# Proposal

## Why

第八轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-8.md`）发现：概设 §10.1 声明 443 承载「FastGPT 后台反代」，但私有化基线 `deploy/nginx/nginx.conf` 只有指向 adapter 的 4 个 location，FastGPT 后台无任何对外入口。私有化客户服务器通常不允许 SSH 直连，知识运营无法进入 FastGPT 后台维护知识库。同时详设 §1 的错误码、Result 类型、日志字段、config-check 结构与实现不一致。

## What Changes

- **私有化 FastGPT 后台反代**：基线 nginx 增加 8443 server，反代 `fastgpt:3000`；访问控制由 `deploy/nginx/fastgpt-admin-allow.conf` 决定（默认 `deny all;`，`install.sh` 按 `FASTGPT_ADMIN_ALLOW_CIDRS` 生成 `allow` 行）；compose 暴露 `${FASTGPT_ADMIN_PORT:-8443}:8443`。
- **install.sh**：新增「生成 FastGPT 后台白名单」步骤（未配置则保持 `deny all`），并在预检提示。
- **详设 §1 契约对齐**：§1.4 错误码表与 `Result` 类型改为实际（五位码 + 字符串业务码 + `Ok/Err` 类）；§1.5 日志字段改为 `chatHash/userHash` 且正文全级别脱敏；§1.6 `config-check` 返回结构改为 `{mode, config}`。
- **概设 §10.1**：端口矩阵补 8443 管理口与白名单说明。
- **文档**：部署手册、两份用户手册补私有化 FastGPT 后台入口；版本记录。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：新增「受控 FastGPT 管理后台入口」要求。

## Impact

- **配置**：`deploy/nginx/nginx.conf`、`deploy/nginx/fastgpt-admin-allow.conf`（新）、`deploy/docker-compose.yml`、`deploy/install.sh`、`.env.template`、`deploy/.env.template`。
- **文档**：概设 §10.1、详设 §1.4/§1.5/§1.6、部署手册、用户手册（私有化）。
- **测试**：`deploy-runtime.spec.ts` 断言 8443 server、白名单 include、compose 端口映射。
- **安全**：默认拒绝；仅配置网段可访问；不暴露到公网。
