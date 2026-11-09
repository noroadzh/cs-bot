import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { DataType, newDb } from 'pg-mem';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AdminRequestAuditService', () => {
  let audit: any;
  let pool: any;

  beforeAll(async () => {
    setConfig({});
    const db = newDb({ autoCreateForeignKeyIndices: true });
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => '11111111-1111-4111-8111-111111111111',
      impure: true,
    });
    const sql = readFileSync(
      join(process.cwd(), 'src/admin/024-admin-identity.sql'),
      'utf8',
    );
    db.public.none(
      sql.replace(/TIMESTAMPTZ/g, 'TIMESTAMP').replace(/BIGSERIAL/g, 'SERIAL'),
    );
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    const mod = await import('../src/admin/admin-request-audit.service.js');
    audit = new mod.AdminRequestAuditService({} as any);
    (audit as any).pool = pool;
  });

  afterAll(async () => {
    await pool?.end?.();
    resetConfig();
  });

  it('persists one row without password fields', async () => {
    await pool.query(
      `INSERT INTO admin_audit_log
         (user_id, username, role_code, method, path, status, cost_ms, client_ip, surface)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        '11111111-1111-4111-8111-111111111111',
        'admin',
        'admin',
        'GET',
        '/admin/license',
        200,
        12,
        '127.0.0.1',
        'admin',
      ],
    );
    const listed = await audit.list({ username: 'admin', limit: 10 });
    expect(listed.total).toBe(1);
    expect(listed.rows[0]).toMatchObject({
      username: 'admin',
      roleCode: 'admin',
      method: 'GET',
      path: '/admin/license',
      status: 200,
    });
    expect(JSON.stringify(listed.rows[0])).not.toMatch(/password/i);
  });
});
