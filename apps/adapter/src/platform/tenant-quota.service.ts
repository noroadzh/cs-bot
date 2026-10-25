/**
 * TenantQuotaService — M11 租户配额（spec tenant-quota）
 *
 * - setQuota：PATCH 子集 upsert，写审计 tenant.quota-set（带 before/after 全维度快照）
 * - consume：原子消耗，区分 429（超限）/ 404（租户不存在）
 */

import {
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { NoopQuotaPusher, type QuotaPusher } from './quota-pusher.js';
import type { TenantQuota, TenantQuotaPatch } from './tenant.entity.js';

/** 平台默认配额（spec: max_chats 5 / max_msgs_per_day 5000 / max_storage_mb 2048 / max_concurrent_qa 2） */
export const DEFAULT_QUOTA = {
  maxChats: 5,
  maxStorageMb: 2048,
  maxApiCalls: 5000,
  maxUsers: 2,
  maxLlmTokensPerMonth: 0,
} as const;

const QUOTA_COLUMNS = [
  { key: 'maxChats', column: 'max_chats' },
  { key: 'maxStorageMb', column: 'max_storage_mb' },
  { key: 'maxApiCalls', column: 'max_api_calls' },
  { key: 'maxUsers', column: 'max_users' },
  { key: 'maxLlmTokensPerMonth', column: 'max_llm_tokens_per_month' },
] as const;

export interface QuotaConsumeInput {
  tenantId: string;
  kind: 'chat' | 'api_call' | 'storage' | 'user';
  delta: number;
}

/** quota consume 维度 */
export type QuotaKind = QuotaConsumeInput['kind'];

export interface QuotaConsumeResult {
  allowed: boolean;
  limit: number;
  used: number;
  limitColumn: string;
}

@Injectable()
export class TenantQuotaService {
  private readonly logger = new AppLogger('TenantQuotaService');
  private readonly pool: Pool;

  constructor(
    private readonly audit: PlatformAuditService,
    _config: ConfigService,
  ) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  private pusher: QuotaPusher = new NoopQuotaPusher();

  /** 注入配额下发通道（生产推实例 / 测试 fake） */
  setQuotaPusher(p: QuotaPusher): void {
    this.pusher = p;
  }

  // -------------------------------------------------------------------------
  // setQuota — PATCH 子集 + 审计 before/after
  // -------------------------------------------------------------------------

  async setQuota(tenantId: string, patch: TenantQuotaPatch, actor = 'system'): Promise<TenantQuota> {
    const entries = QUOTA_COLUMNS.filter((f) => patch[f.key] !== undefined);
    if (entries.length === 0) {
      throw new BadRequestException({
        errCode: 'TENANT_QUOTA_INVALID',
        detail: 'no quota dimension provided',
      });
    }
    for (const f of entries) {
      const v = patch[f.key] as number;
      if (!Number.isInteger(v) || v < 1) {
        throw new BadRequestException({
          errCode: 'TENANT_QUOTA_INVALID',
          detail: `${f.key} must be a positive integer`,
          field: f.key,
        });
      }
    }

    const before = await this.getQuota(tenantId);
    if (!before) {
      throw new NotFoundException({
        errCode: 'TENANT_NOT_FOUND',
        detail: `tenant ${tenantId} not found`,
      });
    }

    const setClauses = entries.map((f, i) => `${f.column} = $${i + 2}`).join(', ');
    const params: unknown[] = [tenantId];
    for (const f of entries) params.push(patch[f.key]);

    const res = await this.pool.query(
      `UPDATE tenant_quota SET ${setClauses}, updated_at = NOW()
       WHERE tenant_id = $1
       RETURNING id, tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month, created_at, updated_at`,
      params,
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        errCode: 'TENANT_NOT_FOUND',
        detail: `tenant ${tenantId} not found`,
      });
    }
    const after = mapQuota(res.rows[0]);

    await this.audit.append({
      action: 'tenant.quota-set',
      actor,
      tenantId,
      payload: {
        tenantId,
        before: {
          maxChats: before.maxChats,
          maxStorageMb: before.maxStorageMb,
          maxApiCalls: before.maxApiCalls,
          maxUsers: before.maxUsers,
          maxLlmTokensPerMonth: before.maxLlmTokensPerMonth,
        },
        after: {
          maxChats: after.maxChats,
          maxStorageMb: after.maxStorageMb,
          maxApiCalls: after.maxApiCalls,
          maxUsers: after.maxUsers,
          maxLlmTokensPerMonth: after.maxLlmTokensPerMonth,
        },
      },
    });

    // 即时下发（best-effort，不影响配额已落库）
    await this.pusher.push(tenantId, after).catch(() => undefined);

    return after;
  }

  // -------------------------------------------------------------------------
  // getQuota — 读配额行
  // -------------------------------------------------------------------------

  async getQuota(tenantId: string): Promise<TenantQuota | null> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month, created_at, updated_at
       FROM tenant_quota WHERE tenant_id = $1`,
      [tenantId],
    );
    return res.rows.length > 0 ? mapQuota(res.rows[0]) : null;
  }

  // -------------------------------------------------------------------------
  // ensureDefaultQuota — 新租户建默认配额行
  // -------------------------------------------------------------------------

  async ensureDefaultQuota(tenantId: string): Promise<TenantQuota> {
    const res = await this.pool.query(
      `INSERT INTO tenant_quota
         (tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW()
       RETURNING id, tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month, created_at, updated_at`,
      [
        tenantId,
        DEFAULT_QUOTA.maxChats,
        DEFAULT_QUOTA.maxStorageMb,
        DEFAULT_QUOTA.maxApiCalls,
        DEFAULT_QUOTA.maxUsers,
        DEFAULT_QUOTA.maxLlmTokensPerMonth,
      ],
    );
    return mapQuota(res.rows[0]);
  }

  // -------------------------------------------------------------------------
  // consume — 原子消耗，区分 429/404
  // -------------------------------------------------------------------------

  async consume(input: QuotaConsumeInput): Promise<QuotaConsumeResult> {
    return consumeQuota(this.pool, input);
  }
}

const CONSUME_SPEC: Record<
  'chat' | 'api_call' | 'storage' | 'user',
  { countColumn: string; limitColumn: string }
> = {
  chat: { countColumn: 'chat_count', limitColumn: 'max_chats' },
  api_call: { countColumn: 'api_call_count', limitColumn: 'max_api_calls' },
  storage: { countColumn: 'storage_bytes', limitColumn: 'max_storage_mb' },
  user: { countColumn: 'user_count', limitColumn: 'max_users' },
};

/**
 * 原子消耗配额（纯函数，供 TenantQuotaService 与数据面 TenantGateService 复用）。
 * 显式传入 Pool，避免数据面模块依赖 PlatformModule 造成循环 import。
 */
export async function consumeQuota(
  pool: Pool,
  input: QuotaConsumeInput,
): Promise<QuotaConsumeResult> {
  const { kind, delta } = input;
  const spec = CONSUME_SPEC[kind];

  if (!Number.isInteger(delta) || delta < 0) {
    throw new BadRequestException({
      errCode: 'TENANT_QUOTA_INVALID',
      detail: 'delta must be a non-negative integer',
    });
  }

  // Step 1: 确认租户存在
  const tenantRes = await pool.query(
    'SELECT id FROM tenant WHERE id = $1 AND deleted_at IS NULL',
    [input.tenantId],
  );
  if (tenantRes.rows.length === 0) {
    throw new NotFoundException({
      errCode: 'TENANT_NOT_FOUND',
      detail: `tenant ${input.tenantId} not found`,
    });
  }

  // Step 2: 确保今日行存在（ON CONFLICT DO NOTHING 幂等）
  await pool.query(
    `INSERT INTO tenant_usage_daily
       (id, tenant_id, day, chat_count, api_call_count, storage_bytes, user_count)
     VALUES (gen_random_uuid(), $1, CURRENT_DATE, 0, 0, 0, 0)
     ON CONFLICT (tenant_id, day) DO NOTHING`,
    [input.tenantId],
  );

  // Step 3: 原子 UPDATE … WHERE count + Δ <= limit
  const res = await pool.query(
    `UPDATE tenant_usage_daily
     SET ${spec.countColumn} = ${spec.countColumn} + $2, updated_at = NOW()
     WHERE tenant_id = $1 AND day = CURRENT_DATE
       AND COALESCE(
         (SELECT ${spec.limitColumn} FROM tenant_quota WHERE tenant_id = $1),
         0
       ) >= ${spec.countColumn} + $2
     RETURNING ${spec.countColumn} AS used`,
    [input.tenantId, delta],
  );

  if (res.rows.length > 0) {
    const limit = await readQuotaLimit(pool, input.tenantId, spec.limitColumn);
    const used = Number(res.rows[0].used);
    return { allowed: true, limit, used, limitColumn: spec.limitColumn };
  }

  // Step 4: 0 行 → 查限值，区分 429（超限）vs 404
  const limit = await readQuotaLimit(pool, input.tenantId, spec.limitColumn);
  const used = await readUsageUsed(pool, input.tenantId, spec.countColumn);
  throw new HttpException(
    {
      errCode: 'TENANT_QUOTA_EXCEEDED',
      detail: `quota exceeded: ${spec.limitColumn} (limit ${limit}, used ${used})`,
      limitColumn: spec.limitColumn,
      limit,
      used,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

async function readQuotaLimit(pool: Pool, tenantId: string, column: string): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(${column}, 0) AS v FROM tenant_quota WHERE tenant_id = $1`,
    [tenantId],
  );
  return res.rows.length > 0 ? Number(res.rows[0].v) : 0;
}

async function readUsageUsed(pool: Pool, tenantId: string, column: string): Promise<number> {
  const res = await pool.query(
    `SELECT COALESCE(${column}, 0) AS v FROM tenant_usage_daily
     WHERE tenant_id = $1 AND day = CURRENT_DATE`,
    [tenantId],
  );
  return res.rows.length > 0 ? Number(res.rows[0].v) : 0;
}

export function mapQuota(row: Record<string, unknown>): TenantQuota {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    maxChats: Number(row.max_chats),
    maxStorageMb: Number(row.max_storage_mb),
    maxApiCalls: Number(row.max_api_calls),
    maxUsers: Number(row.max_users),
    maxLlmTokensPerMonth: Number(row.max_llm_tokens_per_month ?? 0),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}
