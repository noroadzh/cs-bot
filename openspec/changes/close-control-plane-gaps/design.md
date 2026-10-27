# Design

## Context

控制面与租户实例已拆分：控制面独立 DB/端口/鉴权，租户实例六服务 compose。当前缺口集中在“控制面 → 实例”的下发链路、实例 → 控制面的上报链路、监控探测口径与按租户备份。约束：不破坏现有 `/platform/*` 管理 API；租户实例通过新增内部端点接收同步；群聊/数据面行为不变。

## Goals / Non-Goals

**Goals:**
- 配额/状态变更即时到达实例并本地生效；
- 实例日报可在真实网络中到达控制面；
- 监控探测适配租户 443/TLS；
- 每日备份覆盖每个租户实例。

**Non-Goals:**
- 不在本阶段改管理面路径/错误码（BREAKING，需单独决策）；
- 不实现控制面 Web UI / mTLS；
- 不在本机完成真实多租户 UAT（提供可选脚本）。

## Decisions

### D1: 控制面 → 实例同步（内部端点）
- 租户数据面新增 `POST /internal/tenant/sync`：
  - Header `Authorization: Bearer <TENANT_SYNC_TOKEN>`（控制面/实例共享）；
  - Body `{ status, expiredAt, quota:{maxChats,maxApiCalls,maxStorageMb,maxUsers,maxLlmTokensPerMonth} }`；
  - 本地 upsert `tenant`/`tenant_quota`，供 TenantGate 立即生效。
- 控制面 `HttpTenantSyncClient`：
  - URL：`{PLATFORM_INSTANCE_SCHEME}://{host}:{port}`（默认 https）；
  - TLS 校验由 `PLATFORM_VERIFY_TLS` 控制；
  - 失败重试 3 次指数退避；最终失败写审计 `tenant.sync`（payload 不含密钥）。
- 触发点：`setQuota`、`suspend`、`resume`、`renew`、到期 sweep 状态迁移、provision 成功后。
- 备选：控制面直接 docker exec psql。放弃：耦合宿主/容器名，且 SaaS 未来可能跨宿主。

### D2: 实例 → 控制面上报连通
- 不共享租户网络（保持每租户独立网络/隔离）；控制面端口发布到宿主（`CONTROL_PLANE_BIND`，默认 0.0.0.0:3100）。
- 租户 adapter 增加 `host.docker.internal:host-gateway`，通过宿主网关访问控制面。
- 租户 env 注入 `CONTROL_PLANE_URL`（默认 `http://host.docker.internal:3100`）与 `CONTROL_PLANE_TOKEN`。
- 上报接口已有 Bearer token 放行，保持；控制面端口需防火墙限制到内网。

### D3: 监控探测
- `HttpHealthSource` 查询 tenant 的 `host`/`port`，构造 `{scheme}://{host}:{port}/healthz`。
- 配置：`PLATFORM_INSTANCE_SCHEME=https`、`PLATFORM_VERIFY_TLS=true`；关闭校验时使用 https agent。
- 保持失败→unhealthy 的现有行为。

### D4: 按租户备份
- 新增 `scripts/backup-tenants.sh`（由 `backup.sh` 调用）：
  - 遍历 `PLATFORM_COMPOSE_DIR/*/docker-compose.yml`；
  - 对每个 tenant：`docker compose -p csbot-t-<id> exec -T pg pg_dump`、`mongo mongodump`、tar data/license；
  - 单租户失败只记录并继续；保留 7 天；输出到 `backup/tenants/<id>/<date>/`。
- 真实环境可选执行；测试用 fake docker 验证命令序列。

### D5: P1/P2（本变更记录，不在 P0 实现）
- FastGPT 初始化交接：文档化 API Key/渠道配置 + `PUT /secrets` + 重启；后续可加自动化。
- License 指纹：`PLATFORM_LICENSE_FINGERPRINT` 显式配置并校验。
- 契约对齐（路径/错误码）为 BREAKING，单独变更决策。
- 真实多租户 UAT、流式导入、被动回复/UI/mTLS 留待后续。

## Risks / Trade-offs

- [同步端点暴露] → 仅内网/Bearer token；租户网络不暴露公网。
- [控制面不可达] → 同步失败重试+审计；实例保留本地旧值并继续服务。
- [共享网络] → 部署需预创建 external network（compose 自动创建主网络）。
- [备份耗时] → 按租户串行、失败隔离、低峰执行。


## Recorded Decisions (2026-10-27)

- **5.3 契约偏差（保持现状）**：保留 `/admin/import-jobs` 与现有 `ErrCode` 数值；详设路径/错误码差异作为已接受偏差记录。若未来对齐，按 **BREAKING** 单独变更并同步客户端。
- **6.2 被动回复**：群聊 appchat 不支持被动回包，保持“立即 ack + 主动发送”；单聊/应用消息的 PassiveReplyStrategy 在本产品阶段关闭。
- **6.3 grace 知识库只读**：知识库在 FastGPT 外部后台，适配层无法强制；已在部署手册附录 A 记录运营约束。
- **6.4 UI/mTLS/confirmToken**：本期管理面为 API-only；Web UI、mTLS、destroy confirmToken 记录关闭，后续按产品需要单独立项。
