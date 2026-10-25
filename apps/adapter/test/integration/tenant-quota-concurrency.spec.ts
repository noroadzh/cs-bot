/**
 * 5.1 真实 PG 并发竞争测试（integration）
 *
 * 需要一个真实 PostgreSQL，通过 env `TEST_PG_URL` 提供，例如：
 *   TEST_PG_URL=postgresql://postgres:postgres@127.0.0.1:5432/csbot_test \
 *     npx jest test/integration/tenant-quota-concurrency.spec.ts
 *
 * 未设置 `TEST_PG_URL` 时整个 suite skip，不影响常规单测。
 *
 * 验证点：`consumeQuota` 的 `UPDATE ... WHERE count+Δ <= limit RETURNING`
 * 在并发下是原子的——max_chats=1 时 3 个并发 delta=1 只应有 1 个成功，
 * 其余 2 个抛 429（TENANT_QUOTA_EXCEEDED），且最终计数恰为 1。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

const SRC = join(process.cwd(), 'src');

/** 收集所有追加式迁移 SQL，按编号升序 */
function migrationFiles(): string[] {
  const files: { seq: string; path: string }[] = [];
  for (const dir of readdirSync(SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(SRC, dir.name);
    for (const f of readdirSync(full)) {
      const m = /^(\d{3})-.*\.sql$/.exec(f);
      if (m) files.push({ seq: m[1], path: join(full, f) });
    }
  }
  return files.sort((a, b) => a.seq.localeCompare(b.seq)).map((x) => x.path);
}

suite('TenantQuotaService 真实 PG 并发竞争（5.1）', () => {
  let pool: Pool;
  let consumeQuota: typeof import('../../src/platform/tenant-quota.service.js')['consumeQuota'];

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 10 });
    // 应用迁移（幂等 DDL）
    for (const file of migrationFiles()) {
      const sql = readFileSync(file, 'utf8');
      await pool.query(sql);
    }
    ({ consumeQuota } = await import('../../src/platform/tenant-quota.service.js'));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // 每个用例清空两张配额相关表
    await pool.query('DELETE FROM tenant_usage_daily');
    await pool.query('DELETE FROM tenant_quota');
    await pool.query('DELETE FROM tenant');
  });

  async function seedTenant(maxChats: number): Promise<string> {
    const id = '11111111-1111-4111-8111-111111111111';
    await pool.query(
      `INSERT INTO tenant (id, name, status) VALUES ($1, '并发测试租户', 'active')`,
      [id],
    );
    await pool.query(
      `INSERT INTO tenant_quota (tenant_id, max_chats, max_storage_mb, max_api_calls, max_users)
       VALUES ($1, $2, 2048, 5000, 2)`,
      [id, maxChats],
    );
    return id;
  }

  it('max_chats=1，3 并发 delta=1 → 恰好 1 成功，其余 429，计数=1', async () => {
    const tenantId = await seedTenant(1);

    const results = await Promise.allSettled(
      [0, 1, 2].map(() => consumeQuota(pool, { tenantId, kind: 'chat', delta: 1 })),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(2);
    for (const f of failed) {
      const reason = (f as PromiseRejectedResult).reason as {
        getStatus?: () => number;
        response?: { errCode?: string };
      };
      expect(reason.response?.errCode).toBe('TENANT_QUOTA_EXCEEDED');
      expect(reason.getStatus?.()).toBe(429);
    }

    const used = await pool.query(
      `SELECT chat_count FROM tenant_usage_daily WHERE tenant_id = $1 AND day = CURRENT_DATE`,
      [tenantId],
    );
    expect(Number(used.rows[0].chat_count)).toBe(1);
  });

  it('max_chats=5，10 并发 delta=1 → 恰好 5 成功，计数=5', async () => {
    const tenantId = await seedTenant(5);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        consumeQuota(pool, { tenantId, kind: 'chat', delta: 1 }),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(5);

    const used = await pool.query(
      `SELECT chat_count FROM tenant_usage_daily WHERE tenant_id = $1 AND day = CURRENT_DATE`,
      [tenantId],
    );
    expect(Number(used.rows[0].chat_count)).toBe(5);
  });

  it('delta 超过剩余额度 → 0 行，429（不部分扣减）', async () => {
    const tenantId = await seedTenant(2);
    await consumeQuota(pool, { tenantId, kind: 'chat', delta: 2 }); // 用满

    await expect(
      consumeQuota(pool, { tenantId, kind: 'chat', delta: 1 }),
    ).rejects.toMatchObject({ response: { errCode: 'TENANT_QUOTA_EXCEEDED' } });

    const used = await pool.query(
      `SELECT chat_count FROM tenant_usage_daily WHERE tenant_id = $1 AND day = CURRENT_DATE`,
      [tenantId],
    );
    expect(Number(used.rows[0].chat_count)).toBe(2);
  });
});
