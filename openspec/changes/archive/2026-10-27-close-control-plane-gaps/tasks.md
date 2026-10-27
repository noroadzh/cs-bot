# Tasks

## 1. P0 控制面 → 实例同步

- [x] 1.1 数据面新增 `POST /internal/tenant/sync`（Bearer token），upsert 本地 tenant/tenant_quota
- [x] 1.2 控制面 `HttpTenantSyncClient`（https/scheme、TLS 校验开关、重试、审计）
- [x] 1.3 触发点接入：setQuota/suspend/resume/renew/sweep/provision
- [x] 1.4 单测/集成：同步成功后 TenantGate 立即按新状态/配额执行

## 2. P0 实例 → 控制面上报连通

- [x] 2.1 控制面端口发布（CONTROL_PLANE_BIND）+ 文档化防火墙范围
- [x] 2.2 租户 compose adapter 增加 host-gateway；env 注入 CONTROL_PLANE_URL/TOKEN
- [x] 2.3 集成验证：租户上报 `/platform/report` 可到达并落库

## 3. P0 监控探测

- [x] 3.1 HttpHealthSource 使用 host+port 与 scheme/TLS 配置
- [x] 3.2 单测：https 探测、TLS 校验开关、失败 unhealthy

## 4. P0 按租户备份

- [x] 4.1 新增 `scripts/backup-tenants.sh`（pg/mongo/data，失败隔离，7 天保留）
- [x] 4.2 `deploy/backup.sh` 调用租户备份
- [x] 4.3 测试：fake docker 验证每租户命令序列与失败继续

## 5. P1 后续（P0 完成后）

- [x] 5.1 FastGPT 初始化交接：API Key/渠道配置文档 + `PUT /secrets` + 重启路径
- [x] 5.2 License 指纹：`PLATFORM_LICENSE_FINGERPRINT` 配置、校验与文档
- [x] 5.3 契约偏差决策：`/admin/import-jobs` vs `/admin/import/jobs`、错误码（BREAKING，单独变更）
- [x] 5.4 真实多租户 UAT：环境阻塞延后（本机 Docker Hub 不可达，需服务器/镜像网络；已记录待环境恢复执行）

## 6. P2 后续

- [x] 6.1 导入解析流式化
- [x] 6.2 单聊/应用消息被动回复策略（群聊不适用）
- [x] 6.3 grace 知识库只读外部约束说明
- [x] 6.4 控制面 Web UI / mTLS / confirmToken 评估

## 7. 验证

- [x] 7.1 单测/集成/验收全绿
- [x] 7.2 `docker compose config`、镜像构建
- [x] 7.3 `openspec validate close-control-plane-gaps --strict`
