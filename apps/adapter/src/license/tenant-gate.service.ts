/**
 * TenantGateService — 数据面租户准入闸门（M11 配额/状态）
 *
 * 形态 B（每租户一实例）下，数据面用 `TENANT_ID` 识别当前租户，在消息入口做三层准入：
 *   1. 租户状态：active/grace 放行；created/provisioning/paused/terminated/provisioning_failed 拒绝
 *   2. 群准入：新群首次授权消耗 `chat` 配额，超 `max_chats` → 拒绝
 *   3. 消息处理：每条消息消耗 `api_call` 配额，超 `max_msgs_per_day` → 拒绝
 *
 * 自持 Pool（与 LicensedChatService 一致），复用 `consumeQuota` 纯函数，
 * 避免 LicenseModule → PlatformModule 的循环依赖。
 * `TENANT_ID` 为空 → 全部放行（私有化 / 未启用 M11 的部署）。
 *
 * 注：webhook 回调必须返回 200（否则企微重试），因此「拒绝」表现为
 * 调用方代发提示话术 + 200 ack，而不是 spec 字面的 HTTP 409/403/429。
 */
import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { consumeQuota, type QuotaConsumeInput } from '../platform/tenant-quota.service.js';

export type TenantGateReason = 'tenant-inactive' | 'tenant-readonly' | 'tenant-chat-limit' | 'tenant-msg-limit';

export type TenantGateDecision =
  | { allowed: true }
  | { allowed: false; reason: TenantGateReason };

/** 允许数据面服务的租户状态（active + 宽限期 grace） */
const SERVING_STATUSES = new Set(['active', 'grace']);

@Injectable()
export class TenantGateService {
  private readonly logger = new AppLogger('TenantGateService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  private get tenantId(): string {
    return ConfigService.instance.TENANT_ID || '';
  }

  /**
   * 数据面准入检查。
   * @param isNewChat 是否为新群首次授权（尚未在 licensed_chat 中）
   */
  async check(isNewChat: boolean): Promise<TenantGateDecision> {
    const tenantId = this.tenantId;
    if (!tenantId) return { allowed: true };

    // 1. 租户状态
    const status = await this.readStatus(tenantId);
    if (status === null) {
      // 租户不存在 → 配置错误，放行避免误伤，仅告警
      this.logger.warn({ detail: 'tenant-not-found', tenantId });
      return { allowed: true };
    }
    if (!SERVING_STATUSES.has(status)) {
      this.logger.warn({ detail: 'tenant-inactive', tenantId, status });
      return { allowed: false, reason: 'tenant-inactive' };
    }
    // grace = 只读：既有群问答可用，禁止新增群
    if (status === 'grace' && isNewChat) {
      this.logger.warn({ detail: 'tenant-readonly-new-chat', tenantId });
      return { allowed: false, reason: 'tenant-readonly' };
    }

    // 2. 新群准入：消耗 chat 配额
    if (isNewChat) {
      if (!(await this.tryConsume(tenantId, 'chat'))) {
        return { allowed: false, reason: 'tenant-chat-limit' };
      }
    }

    // 3. 消息处理：消耗 api_call 配额
    if (!(await this.tryConsume(tenantId, 'api_call'))) {
      return { allowed: false, reason: 'tenant-msg-limit' };
    }

    return { allowed: true };
  }

  private async readStatus(tenantId: string): Promise<string | null> {
    try {
      const res = await this.pool.query(
        'SELECT status FROM tenant WHERE id = $1 AND deleted_at IS NULL',
        [tenantId],
      );
      return res.rows.length > 0 ? String(res.rows[0].status) : null;
    } catch (err) {
      // DB 不可用 / 表未建 → 放行，不因配额库故障阻断消息
      this.logger.warn({ detail: 'tenant-status-read-failed', err: (err as Error).message });
      return null;
    }
  }

  private async tryConsume(tenantId: string, kind: QuotaConsumeInput['kind']): Promise<boolean> {
    try {
      const r = await consumeQuota(this.pool, { tenantId, kind, delta: 1 });
      return r.allowed;
    } catch (err) {
      // 超限抛 TENANT_QUOTA_EXCEEDED（429）；其余（DB 故障等）放行
      const code = (err as { response?: { errCode?: string } })?.response?.errCode;
      if (code === 'TENANT_QUOTA_EXCEEDED') {
        this.logger.warn({ detail: 'tenant-quota-exceeded', tenantId, kind });
        return false;
      }
      this.logger.warn({ detail: 'tenant-consume-failed', kind, err: (err as Error).message });
      return true;
    }
  }
}
