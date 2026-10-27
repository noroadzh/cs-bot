/**
 * TenantUsageService — M11 租户日聚合用量（spec tenant-quota, design D4）
 *
 * - upsertCount: 当日行幂等 upsert（ON CONFLICT DO UPDATE）
 * - queryUsage: 区间查询 + totals
 */

import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { UsageDayRow, UsageQueryResult, UsageDelta } from './tenant.entity.js';

const USAGE_COLUMNS = [
  { key: 'chatCount', column: 'chat_count' },
  { key: 'apiCallCount', column: 'api_call_count' },
  { key: 'storageBytes', column: 'storage_bytes' },
  { key: 'userCount', column: 'user_count' },
] as const;

@Injectable()
export class TenantUsageService {
  private readonly logger = new AppLogger('TenantUsageService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  /**
   * 当日行幂等 upsert。首次调用自动建行，后续累计。
   */
  async upsertCount(tenantId: string, delta: UsageDelta): Promise<void> {
    const setParts = USAGE_COLUMNS.map((c) => `${c.column} = tenant_usage_daily.${c.column} + EXCLUDED.${c.column}`).join(', ');
    await this.pool.query(
      `INSERT INTO tenant_usage_daily
         (tenant_id, day, chat_count, api_call_count, storage_bytes, user_count)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, day) DO UPDATE SET
         ${setParts}, updated_at = NOW()`,
      [
        tenantId,
        delta.chatCount,
        delta.apiCallCount,
        delta.storageBytes,
        delta.userCount,
      ],
    );
  }

  /**
   * 区间查询，默认最近 30 天。返回 rows（day ASC）+ totals。
   */
  async queryUsage(tenantId: string, from?: string, to?: string): Promise<UsageQueryResult> {
    const now = new Date();
    if (!from) {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      from = d.toISOString().slice(0, 10);
    }
    if (!to) {
      to = now.toISOString().slice(0, 10);
    }

    const res = await this.pool.query(
      `SELECT day, chat_count, api_call_count, storage_bytes, user_count
       FROM tenant_usage_daily
       WHERE tenant_id = $1 AND day >= $2 AND day <= $3
       ORDER BY day ASC`,
      [tenantId, from, to],
    );

    const rows = res.rows.map(mapUsageRow);
    const totals = rows.reduce(
      (acc, r) => {
        acc.chatCount += r.chatCount;
        acc.apiCallCount += r.apiCallCount;
        acc.storageBytes += r.storageBytes;
        acc.userCount += r.userCount;
        return acc;
      },
      { chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 },
    );

    return { rows, totals };
  }

  /** D10：接收适配层日报（计数覆盖，不累加） */
  async upsertReport(
    tenantId: string,
    day: string,
    counters: {
      msgsIn: number;
      triggered: number;
      hit: number;
      miss: number;
      tokens: number;
      activeChats: number;
    },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO tenant_usage_daily
         (id, tenant_id, day, api_call_count, chat_count, msgs_triggered, qa_hit, qa_miss, llm_tokens, active_chats, storage_bytes, user_count)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 0, 0)
       ON CONFLICT (tenant_id, day) DO UPDATE SET
         api_call_count = EXCLUDED.api_call_count,
         chat_count = EXCLUDED.chat_count,
         msgs_triggered = EXCLUDED.msgs_triggered,
         qa_hit = EXCLUDED.qa_hit,
         qa_miss = EXCLUDED.qa_miss,
         llm_tokens = EXCLUDED.llm_tokens,
         active_chats = EXCLUDED.active_chats,
         updated_at = NOW()`,
      [
        tenantId,
        day,
        counters.msgsIn,
        counters.activeChats,
        counters.triggered,
        counters.hit,
        counters.miss,
        counters.tokens,
        counters.activeChats,
      ],
    );
  }

  /** 读取当日汇总（供 getDetail 内联） */
  async todaySummary(tenantId: string): Promise<UsageDayRow> {
    const res = await this.pool.query(
      `SELECT day, COALESCE(chat_count, 0) AS chat_count, COALESCE(api_call_count, 0) AS api_call_count,
              COALESCE(storage_bytes, 0) AS storage_bytes, COALESCE(user_count, 0) AS user_count
       FROM tenant_usage_daily
       WHERE tenant_id = $1 AND day = CURRENT_DATE`,
      [tenantId],
    );
    if (res.rows.length > 0) return mapUsageRow(res.rows[0]);
    return { day: new Date().toISOString().slice(0, 10), chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 };
  }
}

function mapUsageRow(row: Record<string, unknown>): UsageDayRow {
  return {
    day: String(row.day),
    chatCount: Number(row.chat_count),
    apiCallCount: Number(row.api_call_count),
    storageBytes: Number(row.storage_bytes),
    userCount: Number(row.user_count),
  };
}
