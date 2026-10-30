/**
 * 迁移 018：tenant.status 允许 trialing
 *
 * 直接对真实 PostgreSQL 执行 007 + 015 + 018，断言：
 * - trialing 可写入（spec tenant-registry 的生命周期起点）
 * - 非法状态仍被 CHECK 拒绝
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;
const DB = 'csbot_tenant_status_migration';

function dbUrl(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

suite('迁移 018 租户状态', () => {
  let admin: Pool;
  let pool: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: dbUrl(PG_URL!, 'postgres'), max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => undefined);
    await admin.query(`CREATE DATABASE ${DB}`);
    pool = new Pool({ connectionString: dbUrl(PG_URL!, DB), max: 2 });
    for (const f of ['007-tenant.sql', '008-control-plane.sql', '015-tenant-offboarding.sql', '018-tenant-trialing.sql']) {
      await pool.query(readFileSync(join(process.cwd(), 'src/platform', f), 'utf8'));
    }
  });

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await admin?.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  it('status=trialing 可写入', async () => {
    const res = await pool.query(
      "INSERT INTO tenant (name, status) VALUES ('试用租户', 'trialing') RETURNING id, status",
    );
    expect(res.rows[0].status).toBe('trialing');
  });

  it('非法状态仍被约束拒绝', async () => {
    await expect(
      pool.query("INSERT INTO tenant (name, status) VALUES ('非法', 'bogus')"),
    ).rejects.toThrow(/chk_tenant_status/);
  });

  it('015 引入的 offboarding 仍在允许集合内', async () => {
    const res = await pool.query(
      "INSERT INTO tenant (name, status) VALUES ('注销中', 'offboarding') RETURNING status",
    );
    expect(res.rows[0].status).toBe('offboarding');
  });
});
