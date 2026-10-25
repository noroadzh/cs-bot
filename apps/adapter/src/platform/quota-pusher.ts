/**
 * QuotaPusher — 配额变更即时下发（概设 §5 M11 配额下发）
 *
 * 接口可替换：生产可推送实例 / 每日拉取；测试用 fake 断言调用。
 */
import type { TenantQuota } from './tenant.entity.js';

export interface QuotaPusher {
  push(tenantId: string, quota: TenantQuota): Promise<void>;
}

export class NoopQuotaPusher implements QuotaPusher {
  async push(_tenantId: string, _quota: TenantQuota): Promise<void> {
    /* no-op */
  }
}
