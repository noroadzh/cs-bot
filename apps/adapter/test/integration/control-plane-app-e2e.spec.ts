/**
 * 独立控制面 e2e：独立数据库 + Admin Basic Auth + 数据面 Bearer 上报
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { ControlPlaneAppModule } from '../../src/control-plane/control-plane-app.module.js';
import { setConfig } from '../__setup__/test-helpers.js';
import { resetConfig } from '../__setup__/test-helpers.js';

jest.setTimeout(60_000);
const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;
const DB = 'csbot_control_e2e';

function dbUrl(base: string, db: string): string {
  const u = new URL(base);
  u.pathname = `/${db}`;
  return u.toString();
}

const adminAuth = `Basic ${Buffer.from('admin:admin-test-pwd').toString('base64')}`;

suite('独立控制面 e2e', () => {
  let admin: Pool;
  let control: Pool;
  let app: any;
  let createdId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: dbUrl(PG_URL!, 'postgres'), max: 2 });
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => undefined);
    await admin.query(`CREATE DATABASE ${DB}`);

    const controlUrl = dbUrl(PG_URL!, DB);
    control = new Pool({ connectionString: controlUrl, max: 2 });
    const pool = control;
    for (const f of ['007-tenant.sql', '008-control-plane.sql', '011-usage-counters.sql', '012-tenant-ports.sql']) {
      await pool.query(readFileSync(join(process.cwd(), 'src/platform', f), 'utf8'));
    }

    setConfig({
      DATABASE_URL: controlUrl,
      PLATFORM_ENABLED: true,
      PLATFORM_TLS_PROVIDER: 'fake',
      LICENSE_ISSUER: 'noop',
      PLATFORM_MASTER_KEY: 'test-master-key',
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'admin-test-pwd',
      ALLOWED_ADMIN_IPS: '127.0.0.1/32',
      CONTROL_PLANE_TOKEN: 'cp-token',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({ imports: [ControlPlaneAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await control?.end().catch(() => undefined);
    // 不在 afterAll DROP：避免终止仍存活的连接产生 unhandled error；下次 beforeAll 会重建
    await admin?.end().catch(() => undefined);
    resetConfig();
  });

  it('健康检查（控制面自身 DB）', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'control-plane' });
  });

  it('管理 API 需要 Basic Auth', async () => {
    expect((await request(app.getHttpServer()).get('/platform/tenants')).status).toBe(401);
    const ok = await request(app.getHttpServer()).get('/platform/tenants').set('Authorization', adminAuth);
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty('rows');
  });

  it('创建租户 + 数据面 Bearer 上报用量', async () => {
    const created = await request(app.getHttpServer())
      .post('/platform/tenants')
      .set('Authorization', adminAuth)
      .send({ name: 'CP-E2E', contact: 'cp@example.com' });
    expect(created.status).toBe(201);
    createdId = created.body.id;
    expect(createdId).toBeTruthy();

    const report = await request(app.getHttpServer())
      .post('/platform/report')
      .set('Authorization', 'Bearer cp-token')
      .send({
        tenantId: createdId,
        date: '2026-10-27',
        msgsIn: 10, triggered: 8, hit: 6, miss: 2, tokens: 120, activeChats: 3,
      });
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ ok: true });

    const usage = await control.query(
      'SELECT api_call_count, active_chats FROM tenant_usage_daily WHERE tenant_id = $1',
      [createdId],
    );
    expect(usage.rows[0]).toMatchObject({ api_call_count: 10, active_chats: 3 });
  });
});
