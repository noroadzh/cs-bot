/**
 * TenantSyncService — 把控制面的 tenant 状态/配额下发到租户实例
 */
import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantSecretsService } from './tenant-secrets.service.js';
import { HttpTenantSyncClient, type SyncPayload } from './tenant-sync.client.js';

@Injectable()
export class TenantSyncService implements OnModuleDestroy {
  private readonly logger = new AppLogger('TenantSyncService');
  private readonly pool: Pool;
  private readonly client: HttpTenantSyncClient;

  constructor(
    _config: ConfigService,
    @Optional() private readonly secrets?: TenantSecretsService,
    @Optional() private readonly audit?: PlatformAuditService,
  ) {
    const cfg = ConfigService.instance;
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 3 });
    this.client = new HttpTenantSyncClient({
      scheme: cfg.PLATFORM_INSTANCE_SCHEME ?? 'https',
      verifyTls: cfg.PLATFORM_VERIFY_TLS !== false,
      timeoutMs: cfg.PLATFORM_INSTANCE_TIMEOUT_MS ?? 8000,
    });
  }

  /** 测试注入 */
  setClient(client: HttpTenantSyncClient): void {
    (this as any).client = client;
  }

  async sync(tenantId: string): Promise<void> {
    try {
      const t = await this.pool.query(
        `SELECT id, name, status, host, port, expired_at FROM tenant
         WHERE id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      if (t.rows.length === 0) return;
      const row = t.rows[0];
      if (!row.host || !row.port) return;
      const q = await this.pool.query(
        `SELECT max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month, max_docs, max_qa, max_asset_mb
         FROM tenant_quota WHERE tenant_id = $1`,
        [tenantId],
      );
      const token = (await this.secrets?.load(tenantId))?.TENANT_SYNC_TOKEN;
      if (!token) {
        this.logger.warn({ detail: 'tenant-sync-token-missing', tenantId });
        return;
      }
      const payload: SyncPayload = {
        tenantId,
        name: String(row.name),
        status: String(row.status),
        expiredAt: row.expired_at ? new Date(row.expired_at).toISOString() : null,
        quota: {
          maxChats: Number(q.rows[0]?.max_chats ?? 0),
          maxStorageMb: Number(q.rows[0]?.max_storage_mb ?? 0),
          maxApiCalls: Number(q.rows[0]?.max_api_calls ?? 0),
          maxUsers: Number(q.rows[0]?.max_users ?? 0),
          maxLlmTokensPerMonth: Number(q.rows[0]?.max_llm_tokens_per_month ?? 0),
          maxDocs: Number(q.rows[0]?.max_docs ?? 0),
          maxQa: Number(q.rows[0]?.max_qa ?? 0),
          maxAssetMb: Number(q.rows[0]?.max_asset_mb ?? 0),
        },
      };
      await this.client.sync({ id: tenantId, host: String(row.host), port: Number(row.port) }, token, payload);
      this.logger.log({ detail: 'tenant-sync-ok', tenantId });
    } catch (err) {
      this.logger.warn({ detail: 'tenant-sync-failed', tenantId, err: (err as Error).message });
      await this.audit?.append({
        action: 'tenant.sync',
        actor: 'system',
        tenantId,
        payload: { tenantId, error: (err as Error).message.slice(0, 200) },
      }).catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
