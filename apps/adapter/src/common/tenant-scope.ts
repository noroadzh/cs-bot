/**
 * 数据面租户作用域（shared / dedicated 实例均靠 TENANT_ID）
 * 空字符串 = 私有化未绑定租户，仍写列以便日后迁移。
 */
import { ConfigService } from '../config/config.service.js';

export function currentTenantId(): string {
  return ConfigService.instance.TENANT_ID || '';
}

/** Redis key 前缀：有租户时 `t:{id}:`，否则空（兼容既有 key） */
export function tenantRedisPrefix(): string {
  const id = currentTenantId();
  return id ? `t:${id}:` : '';
}

export function tenantRedisKey(suffix: string): string {
  return `${tenantRedisPrefix()}${suffix}`;
}
