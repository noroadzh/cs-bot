# Design

## Context

见 proposal.md。私有化基线只有 adapter 反代；SaaS 租户实例已有 8443 + CIDR 白名单（`shell-provisioner.ts`），可作为参照。

## Goals / Non-Goals

**Goals:**

- 私有化客户的知识运营能通过浏览器访问 FastGPT 后台，无需 SSH 隧道。
- 默认拒绝，只有显式配置的网段可访问；不与 443 公网入口混用。

**Non-Goals:**

- 不把 FastGPT 后台暴露到公网。
- 不改 SaaS 租户的 8443 生成逻辑（已具备）。
- 不做 SSO/额外鉴权（FastGPT 自带账号体系）。

## Decisions

### D1 nginx 独立 8443 server

`deploy/nginx/nginx.conf` 增加：

```
server {
  listen 8443 ssl;
  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  include /etc/nginx/fastgpt-admin-allow.conf;   # allow …; deny all;
  location / {
    proxy_pass http://fastgpt:3000;
    proxy_set_header Host $host; ...
  }
}
```

- 访问控制放在 server 级：`allow/deny` 对所有 location 生效，顺序由生成文件保证。
- 与 443 分离，避免管理面与回调混在同一入口。

### D2 白名单文件由 install.sh 生成

- 仓库内置 `deploy/nginx/fastgpt-admin-allow.conf`，内容 `deny all;`（默认关闭）。
- `install.sh` 读取 `FASTGPT_ADMIN_ALLOW_CIDRS`（逗号分隔），生成：
  - 空 → `deny all;`
  - 非空 → `allow <cidr>;` × N + `deny all;`
- 生成的 `.env` 值会做基本校验（CIDR/单 IP 形式），非法值直接失败，避免把 `deny all` 写坏。
- `--dry-run` 打印将生成的内容；`--check` 提示未配置时后台不可访问。

### D3 compose 端口

`deploy/docker-compose.yml` nginx 端口加 `"${FASTGPT_ADMIN_PORT:-8443}:8443"`；`.env.template` 增加 `FASTGPT_ADMIN_PORT=8443`、`FASTGPT_ADMIN_ALLOW_CIDRS=`。

> 默认端口 8443 与 SaaS 租户一致，便于运维统一记忆；如需改端口只改 env。

### D4 详设 §1 契约对齐

- §1.4 改为实际错误码：五位码区间（10000 企微 / 20000 路由 / 30000 编排 / 40000 过滤 / 50000 素材 / 90000 授权）+ 平台业务字符串码（如 `TENANT_QUOTA_EXCEEDED`）；`Result` 改为 `Ok{value}` / `Err{error}`。
- §1.5 日志字段改为实际：`app/version/env/pid/module/traceId` 基础字段，业务字段 `chatHash/userHash`；正文经 pino redact + `maskPIIPatterns` 在所有级别脱敏。
- §1.6 `config-check` 返回 `{mode:{useMockLlm,useMockLicense}, config:{KEY:{present,masked}}}`。

### D5 文档

- 概设 §10.1 端口矩阵补 8443 行（默认 deny，仅配置网段）。
- 部署手册 §7.9 或运维章节补「FastGPT 后台访问」步骤；私有化用户手册把「由交付方提供」改为「`https://<域名>:8443`（需在白名单网段）」。
- 打包白名单加入 `deploy/nginx/fastgpt-admin-allow.conf`。

## Risks / Trade-offs

- [白名单误配导致所有人被拒] → 默认 deny 是安全侧默认；`install.sh` 输出当前生效网段，手册给排查步骤。
- [8443 暴露在公网] → 文档要求防火墙只放行运维网段；`install.sh --check` 未配置时明确提示「后台不可访问」。
- [证书为自签时浏览器告警] → 与 443 使用同一证书，客户替换即可。

## Migration Plan

1. 升级后 `docker compose up -d nginx` 生效；未配置 `FASTGPT_ADMIN_ALLOW_CIDRS` 时行为与现状一致（后台不可访问）。
2. 回滚：移除 8443 server 与端口映射即可。

## Verification

- `deploy-runtime.spec.ts`：nginx.conf 含 8443 server 与 allow 文件 include；compose 含 8443 映射；默认 allow 文件为 `deny all;`。
- `install-script.spec.ts`：`--dry-run` 输出白名单生成动作。
- `docker compose config` 通过。
- 单测/集成/验收全绿。
