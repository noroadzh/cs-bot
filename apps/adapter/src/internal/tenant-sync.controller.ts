/**
 * 数据面内部端点：接收控制面下发的租户状态/配额
 * 仅内网 + Bearer TENANT_SYNC_TOKEN。
 */
import { Body, Controller, HttpCode, HttpStatus, OnModuleDestroy, Post, UseGuards } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { InternalTokenGuard } from './internal-token.guard.js';

interface SyncBody {
  tenantId?: string;
  name?: string;
  status?: string;
  expiredAt?: string | null;
  quota?: {
    maxChats?: number;
    maxStorageMb?: number;
    maxApiCalls?: number;
    maxUsers?: number;
    maxLlmTokensPerMonth?: number;
  };
}

@Controller('internal/tenant')
@UseGuards(InternalTokenGuard)
export class TenantSyncController implements OnModuleDestroy {
  private readonly logger = new AppLogger('TenantSyncController');
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 3 });
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(@Body() body: SyncBody) {
    const tenantId = String(body.tenantId ?? '');
    if (!tenantId) return { ok: false, error: 'tenantId required' };
    const status = String(body.status ?? 'active');
    const name = String(body.name ?? tenantId);

    await this.pool.query(
      `INSERT INTO tenant (id, name, status, expired_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status,
         expired_at = EXCLUDED.expired_at, updated_at = NOW()`,
      [tenantId, name, status, body.expiredAt ?? null],
    );

    const q = body.quota ?? {};
    await this.pool.query(
      `INSERT INTO tenant_quota (tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET
         max_chats = EXCLUDED.max_chats,
         max_storage_mb = EXCLUDED.max_storage_mb,
         max_api_calls = EXCLUDED.max_api_calls,
         max_users = EXCLUDED.max_users,
         max_llm_tokens_per_month = EXCLUDED.max_llm_tokens_per_month,
         updated_at = NOW()`,
      [tenantId, q.maxChats ?? 0, q.maxStorageMb ?? 0, q.maxApiCalls ?? 0, q.maxUsers ?? 0, q.maxLlmTokensPerMonth ?? 0],
    );

    this.logger.log({ detail: 'tenant-sync', tenantId, status });
    return { ok: true };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
