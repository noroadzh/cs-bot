## Why

P2 已支持 `PLATFORM_TLS_MODE=wildcard` 挂载共享材料 + SNI；首次签发/续期 ACME DNS-01 全自动仍依赖手工或外部脚本，运维缺口大。

## What Changes

- 通配模式下经 ACME DNS-01（或 `PLATFORM_CERT_CMD` 实现 DNS-01）写入 `PLATFORM_WILDCARD_CERT_DIR`
- 租户开通不跑 per-tenant ACME；仅 SNI 挂载
- 续期任务/手动 `POST /platform/tls/wildcard/renew`；失败告警，不静默用过期证
- 部署手册/部署套件文档化 DNS 凭证与 cron

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `tenant-provisioning`: TLS 通配签发/续期行为
- `deployment-suite`: DNS-01/renew 运维开关与脚本边界（相对私有化单域 LE）

## Impact

- 代码：`certificate-provider`、platform TLS API、`deploy/` 脚本
- 非目标：替换私有化 `issue-letsencrypt.sh` 主路径；改 dedicated 模式默认
