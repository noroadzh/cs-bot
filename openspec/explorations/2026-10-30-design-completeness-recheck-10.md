# 概设/详设完整性复核（第十轮，2026-10-30，只读）

## 范围

基准：概设 V1.15、详设 V1.8。本轮核对**安全设计（概设 §9）**与**管理接口契约（详设 §6）**，并检查上一轮新增 8443 管理口是否与既有「仅 443」表述冲突。

## 结论

功能无缺口（M1–M11、R-1~R-8、限额、告警、后台入口均已实现）。本轮发现 **4 处文档不一致**，其中 3 处是上一轮引入 8443 后未同步的安全表述，属本轮新发现。

## 需修正（文档）

### P1 端口基线仍写「仅 443 对外」，与新增 8443 管理口冲突

| 位置 | 现文 |
|---|---|
| 部署手册 §3（:58） | 「仅 443 对外；3000/3001/5432/27017/6379 全部只在容器内网」 |
| 部署手册 §5 准备清单（:128） | 「端口扫描仅 443/22 开放」 |
| 部署手册 §11 安全自查（:568） | 「服务器仅 443（公网）+ 22（白名单）开放」 |
| 概设 §9 端口基线（:696） | 「仅 443 对外」 |

实际：`deploy/docker-compose.yml` 暴露 `443` 与 `${FASTGPT_ADMIN_PORT:-8443}`；8443 默认 `deny all`、仅白名单网段可达（§7.7）。文档应写成「443 公网（限回调/运营网段）；8443 仅运维网段（默认拒绝）」。

### P2 概设 §9 传输安全写「回调 URL 仅暴露 /wecom/callback 单路径」

- 实际 `deploy/nginx/nginx.conf` 暴露 `/wecom/callback`、`/admin/`、`/healthz`、`/`（全部反代 adapter；`/admin` 受 Basic Auth + IP 白名单）。
- 建议改为「业务入口仅 `/wecom/callback`；另有 `/admin/*`（Basic Auth + IP 限制）与 `/healthz`」。

### P3 详设 §6.4 授权接口字段名与实际不符

- 文档：`GET /admin/license → {valid, reason?, expiresAt, daysLeft, maxChats, fingerprint}`
- 实际 `license.controller.ts:22-32`：`{...LicenseState, currentUsage:{messagesReceived,assetsSent}}`；`LicenseState` 字段为 `valid/reason/mock/fingerprint/expiresAtMs/daysLeft/maxChats`（无 `expiresAt`）。

### P4 概设 M6 写「DFA 匹配」，实现为 Aho-Corasick

- `sensitive-filter.service.ts:42` 使用 `AhoCorasick`（多模式自动机，与 DFA 同类但不同算法）。
- 建议改为「Aho-Corasick 多模式匹配」或「自动机匹配（DFA/AC）」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 敏感词热加载 | `fs.watch` + 原子替换 automaton |
| 触发词 | KeywordTrie 原子替换 |
| 授权接口鉴权 | AdminGuard + Basic Auth |
| 回调验签 | 401 + 告警（本轮之前已实现） |
| 素材/导入/未命中接口 | 与详设 §6.2/6.3/6.1 一致（前几轮已对齐） |
| 日志脱敏 | pino redact + maskPIIPatterns（全级别） |
