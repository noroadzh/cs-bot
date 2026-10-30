# 概设/详设完整性复核（第十六轮，2026-10-30，只读）

## 范围

基准：概设 V1.20、详设 V1.11。本轮核对 **§10.2 目录结构 / §10.3 备份与定时任务 / §10.4 监控告警** 及 **M1 access_token 缓存策略**。

## 结论

功能无缺口。发现 **1 处实现与设计不符（P2）** 与 **3 处部署章节文档陈旧（P2）**。

## P2 实现与设计不符

### 1. access_token「提前 5 分钟刷新」未实现

- 概设 M1：*「client 凭证缓存 access_token，**提前 5 分钟刷新**」*
- 实际 `wecom-client.ts:37-66`：本地缓存与 Redis TTL 到期（`ttl > 0` / `Date.now() < expireAt`）才刷新，无 5 分钟提前量；仅在 API 返回 token 失效错误时通过 `send-token-refresh` 兜底。
- 影响：token 临界过期时可能多一次失败请求；与设计承诺不符。
- 建议：把「剩余 <300s」视为失效——本地缓存判断 `expireAt - 300_000`，Redis 判断 `ttl > 300`。

## P2 部署章节陈旧

### 2. §10.2 目录结构与实际不符

| 文档 | 实际 |
|---|---|
| `docker-compose.yml` 在 `/opt/cs-bot` 根 | `deploy/docker-compose.yml`（compose 相对路径基于 deploy/） |
| `nginx/{nginx.conf,certs/}` 在根 | `deploy/nginx/...`（+ `fastgpt-admin-allow.conf`） |
| 无 `logs/` | 宿主 `logs/` 挂载 `/app/logs`（落盘日志） |
| 无迁移目录 | `apps/adapter/src/**/NNN-*.sql`（compose 挂载初始化） |
| `license/license.state` | 反回放状态文件为 `license.lic.antireplay.json` |

### 3. §10.3 备份描述不完整/陈旧

- 写「pg_dump（**两个** database）」；实际 `deploy/backup.sh` dump 三个（adapter / fastgpt / control-plane），脚本头注释也仍写「×2」。
- 未列审计清理 `50 3`（详设 §7 已补）。
- 未列 SaaS 租户备份脚本（已实现并在手册 §9.2.1 记录）。

### 4. §10.4「适配层进程崩溃/重启 → webhook 告警」未实现

- 实际：进程崩溃只能由宿主/云监控发现（日志落 `logs/`）；企微 webhook 告警覆盖 license 到期、LLM 双通道失败、SaaS 实例不健康（平台监控），**没有**崩溃/重启 webhook。
- 建议：措辞改为「进程崩溃由宿主/云监控发现（容器 restart 自愈）；license/LLM/实例异常经 webhook 告警」，或后续在启动时检测上次异常退出并告警（另开变更）。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 每日备份内容 | adapter/fastgpt/control-plane + Mongo + assets，保留 7 天 |
| miss 90 天 / 导入 30/180 天清理 | cron 与实现一致 |
| /healthz 依赖探活 + restart 策略 | 一致 |
| 平台监控（SaaS） | 存活/失败率/资源水位/重启告警已实现 |
