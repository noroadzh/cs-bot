# 概设/详设完整性复核（第八轮，2026-10-30，只读）

## 范围

基准：概设 V1.13、详设 V1.6。本轮核对**详设 §1 工程总则（错误码/日志/配置）**与**概设 §10.1 网络端口矩阵**——此前各轮未覆盖的契约层。

## 结论

M1–M11 功能、R-1~R-8、资源限额、告警均无缺口。本轮发现 **1 项功能缺口（私有化知识运营入口）** 与 **详设 §1 的 4 处契约描述失真**。

## P1 功能缺口

### 私有化版 FastGPT 后台没有对外入口

- 概设 §10.1 端口矩阵：`443/tcp | nginx（宿主映射） | 公网 | 企微回调 /wecom/callback、管理接口 /admin/*、**FastGPT 后台反代**`；并写「3001 | fastgpt | 仅内网（**后台经 nginx 反代对外**）」。
- 实际 `deploy/nginx/nginx.conf` 只有 4 个 location：`/wecom/callback`、`/admin/`、`/healthz`、`/`（全部指向 adapter:3000），**没有 FastGPT 反代**。
- 对比：SaaS 租户实例由 `shell-provisioner.ts:236-273` 生成 8443 server，带 `TENANT_ADMIN_ALLOW_CIDRS` 白名单，反代 `fastgpt:3000`。
- 影响：私有化客户的知识运营无法访问 FastGPT 后台（服务器常不允许 SSH 直连，见本项目既有约束），知识库无法维护——用户手册私有化版也只能写「由交付方按客户网络策略提供」。
- 建议：基线 `deploy/nginx/nginx.conf` 增加受控的 FastGPT 反代（独立端口 8443 + `ADMIN_ALLOW_CIDRS` 白名单，默认 deny），并在 compose 暴露该端口；或明确降级为「客户自建反向代理」并修订概设。

## P2 详设 §1 契约失真

| # | 文档 | 实际 |
|---|---|---|
| 1 | §1.4 错误码：`WECOM_SIGN_INVALID=1001 … DB_FAIL=9002` 等 4 位码，含 `FASTGPT_TIMEOUT/LLM_ALL_FAILED/CONF_LOW/IMPORT_*/CONFIG_MISSING` 等枚举 | `packages/shared/src/errors.ts`：5 位码（10001/20001/30001/90001…），枚举项不同（新增 `WECOM_DECRYPT_FAIL`/`SENSITIVE_HIT`/`ASSET_NOT_FOUND`/`LICENSE_EXPIRED`/`ROUTING_ERROR`，无文档中的若干项）；业务错误大量使用字符串 `errCode`（如 `TENANT_QUOTA_EXCEEDED`） |
| 2 | §1.4 `type Result<T> = { ok:true; data:T } \| { ok:false; code; msg }` | `result.ts`：`Ok{ok:true,value}` / `Err{ok:false,error}`（类） |
| 3 | §1.5 日志字段 `ts, level, module, traceId, chatId, userId(哈希), msgType, errCode, costMs`；正文仅 DEBUG 级 | 实际基础字段 `app/version/env/pid/module/traceId`；业务日志用 `chatHash/userHash`；正文经 `REDACT_PATHS` + `maskPIIPatterns` 在所有级别脱敏（非仅 DEBUG） |
| 4 | §1.6 `GET /admin/config-check` 输出 `[{key, present, masked}]` | 实际 `{ mode:{useMockLlm,useMockLicense}, config:{KEY:{present,masked}} }` |

影响：错误码是响应体对外字段，二期/客户二次开发按文档对接会失败；日志字段名影响排障检索脚本。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 端口暴露 | 仅 nginx 443（SaaS 叠加 control-plane 3100 需显式绑定） |
| 容器非 root | 65532 + CSBOT_UID/GID 覆盖 |
| miss_record 90 天 | 03:30 cron |
| 导入脱敏/原始文件删除 | `import-cleanup` + `sensitive-redactor` |
| 租户隔离 | 独立 compose/网络/库 + 端口段 |
| 控制面不存正文 | 无 question/answer 字段 |
| 混淆与 sourcemap | Dockerfile 70-90 行 + `release-hardening.spec` |
