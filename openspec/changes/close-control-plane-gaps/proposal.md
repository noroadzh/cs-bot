# Proposal: close-control-plane-gaps

## Why

独立控制面与租户实例 compose 已落地，但 SaaS 运营闭环仍有缺口：配额/状态下发仍是 Noop（租户实例只保留开通时种子）、租户→控制面用量上报在网络与 URL 上不可达、平台监控仍按 `http://host/healthz` 探测而租户只暴露 443/TLS、按租户实例的备份尚未实现。另有 FastGPT 初始化/密钥交接、真实多租户验证、契约偏差等后续项。

## What Changes

### P0（本变更优先交付）
- **配额/状态下发**：控制面 setQuota/suspend/resume/grace/quota 变更后，通过租户数据面内部接口（Bearer token）即时同步 tenant 状态与配额；失败重试并记录审计。
- **用量上报连通**：租户 env 注入可达的 `CONTROL_PLANE_URL`/token；租户网络与主控制面网络打通（共享 external network 或网关）；确保 `/platform/report` 可达。
- **监控探测修正**：实例健康探测使用 `https://{host}:{port}/healthz`（可配置 scheme、TLS 校验开关），读取 tenant 端口。
- **按租户备份**：每日备份遍历租户实例，pg_dump tenant DB、mongodump tenant Mongo、打包 tenant data，保留 7 天。

### P1（P0 完成后）
- FastGPT 初始化交接：提供初始化/密钥更新操作路径（API Key/渠道配置）与文档化步骤。
- License 指纹配置与校验（同宿主/跨宿主）。
- 契约偏差决策：导入接口路径 `/admin/import-jobs` vs `/admin/import/jobs`、错误码数值（BREAKING，需单独决策/变更）。
- 真实多租户环境验证（6 容器、TLS/DNS、docker CLI 挂载、跨租户物理隔离）。

### P2（后续）
- 导入解析真正流式化（当前仅阶段内存检查）。
- 单聊/应用消息的被动回复策略（群聊 appchat 不适用）。
- grace 期间知识库只读的外部约束说明；控制面 Web UI；mTLS/confirmToken。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `tenant-quota`: 增加运行时配额/状态下发要求（替换 Noop 推送）。
- `tenant-registry`: 增加租户上报连通性与状态同步要求。
- `platform-monitoring`: 增加 TLS/端口感知的实例探测要求。
- `deployment-suite`: 增加按租户实例备份要求。
- `tenant-provisioning`: 增加 FastGPT 初始化/密钥交接要求。
- `acceptance-testing`: 增加多租户控制面 E2E 要求。

## Impact

- **代码**：`apps/adapter/src/platform`（quota-pusher、tenant.service、platform-monitor、backup 相关）、`apps/adapter/src/control-plane`、租户 compose 渲染（网络/env）、`deploy/backup.sh`。
- **部署**：新增共享网络/控制面可达地址；租户 env 注入 token；备份脚本遍历租户。
- **测试**：控制面→租户同步 e2e、上报连通 e2e、监控 https 探测、备份脚本 dry-run。
- **兼容性**：租户实例需支持内部状态/配额同步接口（新增端点，不破坏现有 API）。
- **风险**：租户网络与控制面连通涉及部署拓扑；真实环境验证仍受服务器/网络可达性限制；契约偏差改动为 BREAKING，单独决策。
