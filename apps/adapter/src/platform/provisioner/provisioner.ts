/**
 * TenantProvisioner — M11 租户实例编排接口（design D1）
 *
 * 默认绑定 ShellProvisioner（docker compose spawn）；测试 / K8s 部署可替换实现，
 * 租户服务只依赖此接口（spec: Provisioner interface substitution）。
 */
import type { Tenant } from '../tenant.entity.js';

export interface TenantProvisioner {
  /** 渲染 per-tenant compose 文件到 PLATFORM_COMPOSE_DIR/<id>/docker-compose.yml，返回文件路径 */
  render(tenant: Tenant, envFile?: string): Promise<string>;
  /** docker compose up -d */
  up(tenant: Tenant): Promise<void>;
  /** 轮询健康检查端点直到 healthy 或超时 */
  probe(tenant: Tenant, timeoutMs: number): Promise<boolean>;
  /** docker compose stop */
  stop(tenant: Tenant): Promise<void>;
  /** docker compose start */
  start(tenant: Tenant): Promise<void>;
  /** docker compose down [-v] */
  down(tenant: Tenant, dropVols: boolean): Promise<void>;
}
