# gap-v3-wildcard-acme-deepen（施工单）

- **OpenSpec**: `openspec/changes/gap-v3-wildcard-acme-deepen/`
- **状态**: 已实现
- **测试**: `pnpm -C apps/adapter test wildcard-tls-renew.spec.ts deploy-runtime.spec.ts`

## 交付

1. `WildcardTlsService` + `GET/POST /platform/tls/wildcard/{status,renew}`（`PLATFORM_CERT_CMD` → `PLATFORM_WILDCARD_CERT_DIR`）
2. `deploy/renew-wildcard-acme-dns01.sh`（env 文档；不替代 `issue-letsencrypt.sh`）
3. 续期/过期失败 → `OPS_WEBHOOK_URL`（`OpsAlertService`）
4. 控制面 config / `docker-compose.saas.yml` 通配 env 注释

## 运维

- 手动续期：`POST /platform/tls/wildcard/renew`（需 `reason`）或宿主执行 `renew-wildcard-acme-dns01.sh`
- 状态：`GET /platform/tls/wildcard/status`（过期且无 renew 会告警）
- 失败 errCode：`TLS_ACME_DNS01_FAILED`
