/**
 * M11 控制面端到端（真实 PG + 假 docker + fake cert/授权/下发）
 *
 * 需要 TEST_PG_URL；未设置则 skip。
 * 覆盖：create → provision（假 docker + 证书 + 授权）→ 设配额 + 下发 → 灰度升级
 *       → 导出 → 双签注销 → 审计链 verify。
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { applyMigrations } from '../__setup__/migrations.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TenantService } from '../../src/platform/tenant.service.js';
import { TenantQuotaService } from '../../src/platform/tenant-quota.service.js';
import { TenantUsageService } from '../../src/platform/tenant-usage.service.js';
import { PlatformAuditService } from '../../src/platform/platform-audit.service.js';
import { UpgradeOrchestrator } from '../../src/platform/upgrade-orchestrator.js';
import { TenantOffboarding } from '../../src/platform/tenant-offboarding.js';
import { PgOffboardingRepo } from '../../src/platform/tenant-offboarding.pg.js';
import { setConfig, resetConfig } from '../__setup__/test-helpers.js';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

suite('M11 控制面 e2e', () => {
  jest.setTimeout(30_000);
  let pool: Pool;
  let healthServer: Server;
  let tmpDir: string;
  let tenantSvc: TenantService;
  let quotaSvc: TenantQuotaService;
  let auditSvc: PlatformAuditService;
  let upgrade: UpgradeOrchestrator;
  let offboarding: TenantOffboarding;
  let tenantId: string;
  const issued: string[] = [];
  const pushed: { id: string; maxChats: number }[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    await pool.query('DELETE FROM tenant_offboarding');
    await pool.query('DELETE FROM tenant_snapshot');
    await pool.query('DELETE FROM tenant_upgrade_batch');
    await pool.query('DELETE FROM platform_audit_log');
    await pool.query('DELETE FROM tenant_usage_daily');
    await pool.query('DELETE FROM tenant_quota');
    await pool.query('DELETE FROM tenant');

    tmpDir = await fs.mkdtemp(join(tmpdir(), 'csbot-cp-'));
    const fakeDocker = join(tmpDir, 'fake-docker.sh');
    await fs.writeFile(fakeDocker, '#!/bin/sh\nif [ "$1" = "inspect" ]; then echo healthy; fi\nexit 0\n', 'utf8');
    await fs.chmod(fakeDocker, 0o755);
    process.env.PLATFORM_DOCKER_BIN = fakeDocker;

    healthServer = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"ok"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => healthServer.listen(0, '127.0.0.1', () => r()));

    setConfig({
      DATABASE_URL: PG_URL,
      PLATFORM_ENABLED: true,
      PLATFORM_COMPOSE_DIR: join(tmpDir, 'compose'),
      PLATFORM_PROVISION_TIMEOUT_MS: 5000,
      PLATFORM_MASTER_KEY: 'test-master-key-12345',
      TENANT_ID: '',
    });

    const cfg = {} as any;
    auditSvc = new PlatformAuditService(cfg);
    quotaSvc = new TenantQuotaService(auditSvc, cfg);
    const usageSvc = new TenantUsageService(cfg);
    tenantSvc = new TenantService(auditSvc, quotaSvc, usageSvc, cfg);
    tenantSvc.setCertificateProvider({
      issue: async (d: string) => ({ cert: `CERT:${d}`, key: `KEY:${d}` }),
    });
    tenantSvc.setLicenseIssuer({
      issue: async (t: { id: string }) => {
        issued.push(t.id);
      },
    });
    quotaSvc.setQuotaPusher({
      push: async (id: string, q: { maxChats: number }) => {
        pushed.push({ id, maxChats: q.maxChats });
      },
    });

    upgrade = new UpgradeOrchestrator({
      snapshot: async () => undefined,
      swapImage: async () => undefined,
      health: async () => true,
      rollback: async () => undefined,
      observe: async () => true,
    });
    offboarding = new TenantOffboarding({
      repo: PgOffboardingRepo.fromPool(pool),
      audit: auditSvc,
      exportPackage: async (id: string) => `data/tenants/${id}/export.enc`,
      deleteTenant: async (id: string) => {
        await pool.query(
          `UPDATE tenant SET status='terminated', deleted_at=NOW(), updated_at=NOW() WHERE id=$1`,
          [id],
        );
      },
    });
  });

  afterAll(async () => {
    try {
      if (healthServer?.listening) await new Promise<void>((r) => healthServer.close(() => r()));
    } catch {
      /* ignore */
    }
    await pool?.end().catch(() => undefined);
    delete process.env.PLATFORM_DOCKER_BIN;
    resetConfig();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('create → provision → quota+下发 → 升级 → 导出 → 双签注销 → verify', async () => {
    const created = await tenantSvc.create({ name: 'CP租户', contact: 'cp@example.com' }, 'ops:alice');
    expect(created.status).toBe('created');
    tenantId = created.id;

    const port = (healthServer.address() as AddressInfo).port;
    await pool.query('UPDATE tenant SET host=$2, port=$3, database_url=$4 WHERE id=$1', [
      tenantId, '127.0.0.1', port, 'csbot_cp_dummy',
    ]);

    const prov = await tenantSvc.provision(tenantId, 'ops:alice');
    expect(prov.status).toBe('active');
    expect(issued).toContain(tenantId);

    const q = await quotaSvc.setQuota(tenantId, { maxChats: 2 }, 'ops:alice');
    expect(q.maxChats).toBe(2);
    expect(pushed.some((p) => p.id === tenantId && p.maxChats === 2)).toBe(true);

    const up = await upgrade.run([tenantId], 'v2');
    expect(up.upgraded).toContain(tenantId);
    expect(up.failed).toEqual([]);

    const exported = await offboarding.export(tenantId);
    expect(exported.path).toContain(tenantId);
    expect(exported.confirmToken).toBeTruthy();

    const scheduled = await offboarding.destroy(tenantId, ['ops:alice', 'ops:bob'], exported.confirmToken);
    expect(scheduled.status).toBe('offboarding');
    const still = await pool.query('SELECT status FROM tenant WHERE id=$1', [tenantId]);
    expect(still.rows[0].status).toBe('offboarding');

    const due = await offboarding.destroyDue(new Date(Date.now() + 8 * 86_400_000));
    expect(due.deleted).toContain(tenantId);
    const row = await pool.query('SELECT status FROM tenant WHERE id=$1', [tenantId]);
    expect(row.rows[0].status).toBe('terminated');
    const confirmation = await pool.query(
      'SELECT tenant_id, approvals FROM tenant_destroy_confirmation WHERE tenant_id=$1',
      [tenantId],
    );
    expect(confirmation.rows).toHaveLength(1);
    expect(confirmation.rows[0].approvals).toHaveLength(2);

    const verify = await auditSvc.verifyChain();
    expect(verify.valid).toBe(true);

    // cleanup
    await pool.query('DELETE FROM tenant_offboarding');
    await pool.query('DELETE FROM tenant WHERE id=$1', [tenantId]);
    await fs.rm(join(process.cwd(), 'data', 'import', tenantId), { recursive: true, force: true });
  });

  it('两租户资源隔离：独立 project/network/DB/卷', async () => {
    const a = await tenantSvc.create({ name: '隔离A' }, 'ops:alice');
    const b = await tenantSvc.create({ name: '隔离B' }, 'ops:alice');
    for (const t of [a, b]) {
      await pool.query('UPDATE tenant SET host=$2, database_url=$3 WHERE id=$1', [
        t.id, '127.0.0.1', `db_${t.id}`,
      ]);
      await tenantSvc.provision(t.id, 'ops:alice');
    }
    const composeDir = join(tmpDir, 'compose');
    const ca = await fs.readFile(join(composeDir, a.id, 'docker-compose.yml'), 'utf8');
    const cb = await fs.readFile(join(composeDir, b.id, 'docker-compose.yml'), 'utf8');
    const netA = `csbot-t-${a.id}-net`;
    const netB = `csbot-t-${b.id}-net`;
    const dbA = `tenant_${a.id.replace(/-/g, '_')}`;
    expect(ca).toContain(netA);
    expect(cb).toContain(netB);
    expect(ca).not.toContain(netB);
    expect(cb).not.toContain(netA);
    expect(ca).toContain(join(composeDir, a.id));
    expect(cb).toContain(join(composeDir, b.id));
    expect(ca).not.toContain(join(composeDir, b.id));
    expect(cb).not.toContain(join(composeDir, a.id));

    await pool.query('DELETE FROM tenant WHERE id = ANY($1)', [[a.id, b.id]]);
    await fs.rm(join(composeDir, a.id), { recursive: true, force: true });
    await fs.rm(join(composeDir, b.id), { recursive: true, force: true });
  });
});
