# 概设/详设完整性复核（第十三轮，2026-10-30，只读）

## 范围

基准：概设 V1.17、详设 V1.11。本轮核对**概设 §9 安全设计「强制」项**在部署脚本/镜像交付链路中的落地。

## 结论

功能无缺口。发现 **2 项安全强制项未在安装链路落地**（P1），以及弱默认值未拦截（P2）。

## P1 安全强制项未落地

### 1. 概设 §9 反逆向：「镜像重算不一致则拒绝 `docker compose up`」

- 原文（:385）：镜像按 digest 分发，交付包附 SHA-256 校验值，**客户侧重算不一致则拒绝 `docker compose up`**。
- 实际：`scripts/package-delivery.sh` 生成 `SHA256SUMS.txt`；但 `deploy/install.sh` **完全不校验**（`grep -n "sha256\|SHA256" deploy/install.sh` 无命中）。部署手册 §7.1 只把它写成人工步骤。
- 影响：一键部署路径可绕过完整性校验；镜像/配置被替换不会被发现。
- 建议：`install.sh` 在预检阶段检测 `SHA256SUMS.txt`：存在则 `sha256sum -c`（macOS `shasum -a 256 -c`），有不匹配项即失败；文件缺失给 WARN（开发/自建包场景）。

### 2. 概设 §9 密钥管理：「FastGPT 后台口令强密码」/ 密钥仅 .env 注入

- 实际 compose 默认值：`POSTGRES_PASSWORD:-cs`、`FASTGPT_ROOT_PASSWORD:-fastgpt123456`、`FASTGPT_FILE_TOKEN:-filetoken1234567890`、`REDIS_PASSWORD:-`（空）。
- `.env.template`：`ADMIN_PASSWORD=please_change_me`、`REDIS_PASSWORD=` 空。
- `install.sh` 预检只要求企微 5 项 + `FASTGPT_API_KEY`，不检查上述口令是否仍为默认/弱值。
- 影响：客户按模板部署后即使用弱口令，与 §9「强密码」「密钥管理」强制项冲突；FastGPT 后台 8443 暴露给运维网段后风险放大。
- 建议：`install.sh` 预检增加强口令校验（`ADMIN_PASSWORD` / `POSTGRES_PASSWORD` / `FASTGPT_ROOT_PASSWORD` / `REDIS_PASSWORD`）：拒绝已知弱默认（`cs`、`fastgpt123456`、`please_change_me`、`password`、`123456`）与长度 <12；`.env.template` 改为空值 + 注释「必填强口令」，并提供 `openssl rand` 生成示例。

## P2 文档表述

### 3. 概设 §9 日志脱敏写「消息正文默认不记 INFO 日志（仅 DEBUG 且生产关闭）」

- 实际：`logger.ts` 的 `REDACT_PATHS` 在所有级别对 `question/answer/content/text/reply` 做 **pino redact**，并对字符串跑 `maskPIIPatterns` 后保留掩码值；不是“不记”，而是“全级别脱敏”。
- 建议：改为「正文在所有级别脱敏（redact + 模式掩码），不以原文落盘」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 管理接口 Basic Auth + IP 白名单 | `AdminGuard` 校验 `ALLOWED_ADMIN_IPS` CIDR + Basic（SHA-256 比对） |
| 容器非 root | 65532 + 可覆盖 |
| 端口基线 | 443 + 8443（白名单）+ 22 |
| 数据留存 | miss 90 天、导入 30/180 天、审计 180 天导出后删除 |
| 租户隔离 | 独立 compose/网络/库/密钥 |
| 混淆与 sourcemap | Dockerfile 70-90 行 + release-hardening 测试 |
