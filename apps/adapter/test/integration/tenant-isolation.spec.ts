/**
 * M11 8.2 跨租户隔离抽测（逻辑层，可本地）
 *
 * 租户实例物理隔离的核心证据：每个租户独立 database。
 * 本测试创建两个独立 database（A/B），各建 approved_qa 并写入不同语料，
 * 断言 A 检索不到 B、B 检索不到 A（跨租户检索 0 命中）。
 *
 * 真实多实例（compose 起两个租户实例）抽测需 CI/有网环境，不在本测试内。
 * 需要 TEST_PG_URL；未设置则 skip。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.setTimeout(60_000);

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

const DB_A = 'csbot_iso_a';
const DB_B = 'csbot_iso_b';

function dbUrl(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

async function dropDb(admin: Pool, db: string): Promise<void> {
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  } catch {
    // 老版本 PG 不支持 WITH (FORCE)，退化
    await admin.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
  }
}

suite('M11 8.2 跨租户隔离抽测（逻辑层）', () => {
  let admin: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL, max: 2 });
    for (const db of [DB_A, DB_B]) {
      await dropDb(admin, db);
      await admin.query(`CREATE DATABASE ${db}`);
    }
  });

  afterAll(async () => {
    for (const db of [DB_A, DB_B]) await dropDb(admin, db);
    await admin?.end().catch(() => undefined);
  });

  it('两个独立 database 的 approved_qa 互不命中', async () => {
    const jobSql = readFileSync(join(process.cwd(), 'src/import/004-import-job.sql'), 'utf8');
    const approvedSql = readFileSync(join(process.cwd(), 'src/import/005-approved-qa.sql'), 'utf8');

    const a = new Pool({ connectionString: dbUrl(PG_URL!, DB_A), max: 2 });
    const b = new Pool({ connectionString: dbUrl(PG_URL!, DB_B), max: 2 });
    try {
      for (const p of [a, b]) {
        for (const sql of [jobSql, approvedSql]) {
          try {
            await p.query(sql);
          } catch (e) {
            if (!/already exists|duplicate/i.test((e as Error).message)) throw e;
          }
        }
      }

      // 各写一条独有语料（source_* 留空，避免外键）
      await a.query(
        `INSERT INTO approved_qa (id, question, answer) VALUES (gen_random_uuid(), '租户A独有问题', '答案A')`,
      );
      await b.query(
        `INSERT INTO approved_qa (id, question, answer) VALUES (gen_random_uuid(), '租户B独有问题', '答案B')`,
      );

      const aOwn = await a.query(`SELECT count(*)::int AS n FROM approved_qa WHERE question = '租户A独有问题'`);
      const aCrossB = await a.query(`SELECT count(*)::int AS n FROM approved_qa WHERE question = '租户B独有问题'`);
      const bOwn = await b.query(`SELECT count(*)::int AS n FROM approved_qa WHERE question = '租户B独有问题'`);
      const bCrossA = await b.query(`SELECT count(*)::int AS n FROM approved_qa WHERE question = '租户A独有问题'`);

      expect(aOwn.rows[0].n).toBe(1);
      expect(bOwn.rows[0].n).toBe(1);
      // 跨租户检索 0 命中
      expect(aCrossB.rows[0].n).toBe(0);
      expect(bCrossA.rows[0].n).toBe(0);
    } finally {
      await a.end().catch(() => undefined);
      await b.end().catch(() => undefined);
    }
  });
});
