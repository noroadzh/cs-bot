/**
 * 7.2 端到端演练：租户全生命周期（真实 PG + 假 docker + 真实 health probe）
 *
 * 需要真实 PostgreSQL：`TEST_PG_URL=postgresql://...`，未设置则 skip。
 *
 * 覆盖链路：
 *   create → provision（render + 假 docker up + HTTP health probe）→ setQuota
 *   → consume 超限 429 → suspend → resume → renew → terminate（幂等）→ audit verify=true
 *
 * 「假 docker」：PLATFORM_DOCKER_BIN 指向一个记录 argv 并 exit 0 的脚本，
 * 验证 ShellProvisioner 的命令拼装与调用序列；probe 走真实本地 HTTP server。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Pool } from 'pg';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

const SRC = join(process.cwd(), 'src');

async function applyMigrations(pool: Pool): Promise<void> {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files: { seq: string; path: string }[] = [];
  for (const dir of readdirSync(SRC, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = join(SRC, dir.name);
    for (const f of readdirSync(full)) {
      const m = /^(\d{3})-.*\.sql$/.exec(f);
      if (m) files.push({ seq: m[1], path: join(full, f) });
    }
  }
  files.sort((a, b) => a.seq.localeCompare(b.seq));
  for (const { path } of files) {
    try {
      await pool.query(readFileSync(path, 'utf8'));
    } catch (err) {
      // 非幂等 DDL（ALTER TABLE ... ADD CONSTRAINT）重复执行时忽略
      const msg = (err as Error).message || '';
      if (/already exists|duplicate/i.test(msg)) continue;
      throw err;
    }
  }
}

suite('7.2 租户全生命周期端到端（真实 PG + 假 docker）', () => {
  jest.setTimeout(30_000);
  let pool: Pool;
  let healthServer: Server;
  let tmpDir: string;
  let fakeDocker: string;
  let dockerLog: string;
  let tenantSvc: any;
  let quotaSvc: any;
  let auditSvc: any;
  let tenantId: string;

  beforeAll(async () => {
    const { setConfig } = await import('../__setup__/test-helpers.js');
    const { PlatformAuditService } = await import('../../src/platform/platform-audit.service.js');
    const { TenantQuotaService } = await import('../../src/platform/tenant-quota.service.js');
    const { TenantUsageService } = await import('../../src/platform/tenant-usage.service.js');
    const { TenantService } = await import('../../src/platform/tenant.service.js');

    pool = new Pool({ connectionString: PG_URL, max: 10 });
    await applyMigrations(pool);

    // 临时目录：fake docker + compose 落盘
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'csbot-e2e-'));
    dockerLog = join(tmpDir, 'docker.log');
    fakeDocker = join(tmpDir, 'fake-docker.sh');
    await fs.writeFile(
      fakeDocker,
      `#!/bin/sh\necho "docker $@" >> "${dockerLog}"\nexit 0\n`,
      'utf8',
    );
    await fs.chmod(fakeDocker, 0o755);

    // 真实 health server，作为 provision probe 的目标
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
      TENANT_ID: '',
    });
    process.env.PLATFORM_DOCKER_BIN = fakeDocker;

    const cfg = {} as any;
    auditSvc = new PlatformAuditService(cfg);
    quotaSvc = new TenantQuotaService(auditSvc, cfg);
    const usageSvc = new TenantUsageService(cfg);
    tenantSvc = new TenantService(auditSvc, quotaSvc, usageSvc, cfg);
  });

  afterAll(async () => {
    try {
      if (healthServer?.listening) await new Promise<void>((r) => healthServer.close(() => r()));
    } catch {
      /* ignore */
    }
    await pool?.end().catch(() => undefined);
    delete process.env.PLATFORM_DOCKER_BIN;
    const { resetConfig } = await import('../__setup__/test-helpers.js');
    resetConfig();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM platform_audit_log');
    await pool.query('DELETE FROM tenant_usage_daily');
    await pool.query('DELETE FROM tenant_quota');
    await pool.query('DELETE FROM tenant');
  });

  it('全链路：create→provision→quota→429→suspend→resume→renew→terminate→audit verify', async () => {
    // 1) create
    const created = await tenantSvc.create({ name: 'E2E租户', contact: 'e2e@example.com', plan: 'standard' }, 'ops:alice');
    expect(created.status).toBe('created');
    tenantId = created.id;
    const quota0 = await quotaSvc.getQuota(tenantId);
    expect(quota0.maxChats).toBe(5);

    // 2) 预置 host/port（生产由平台分配；此处指向本地 health server）
    const port = (healthServer.address() as AddressInfo).port;
    await pool.query('UPDATE tenant SET host = $2, port = $3, database_url = $4 WHERE id = $1', [
      tenantId, '127.0.0.1', port, 'csbot_e2e_dummy',
    ]);

    // 3) provision（假 docker up + 真实 probe）
    const provisioned = await tenantSvc.provision(tenantId, 'ops:alice');
    expect(provisioned.status).toBe('active');
    expect(provisioned.host).toBe('127.0.0.1');
    expect(provisioned.port).toBe(port);

    // 4) setQuota → maxChats=1
    const q = await quotaSvc.setQuota(tenantId, { maxChats: 1 }, 'ops:alice');
    expect(q.maxChats).toBe(1);

    // 5) consume：第 1 次成功，第 2 次 429
    await expect(quotaSvc.consume({ tenantId, kind: 'chat', delta: 1 })).resolves.toMatchObject({ allowed: true });
    await expect(quotaSvc.consume({ tenantId, kind: 'chat', delta: 1 })).rejects.toMatchObject({
      response: { errCode: 'TENANT_QUOTA_EXCEEDED' },
    });

    // 6) suspend → resume
    expect((await tenantSvc.suspend(tenantId, 'ops:alice')).status).toBe('paused');
    expect((await tenantSvc.resume(tenantId, 'ops:alice')).status).toBe('active');

    // 7) renew
    const renewed = await tenantSvc.renew(tenantId, 30, 'ops:alice');
    expect(renewed.status).toBe('active');

    // 8) terminate（幂等：第二次直接返回）
    const term = await tenantSvc.terminate(tenantId, 'ops:alice');
    expect(term.status).toBe('terminated');
    const term2 = await tenantSvc.terminate(tenantId, 'ops:alice');
    expect(term2.status).toBe('terminated');

    // 9) 审计链完整
    const verify = await auditSvc.verifyChain();
    expect(verify.valid).toBe(true);
    expect(verify.entries).toBeGreaterThanOrEqual(6);

    // 10) 假 docker 调用序列（compose up / stop / start / down -v）
    const log = await fs.readFile(dockerLog, 'utf8');
    expect(log).toContain(`compose -p csbot-t-${tenantId}`);
    expect(log).toContain('up -d');
    expect(log).toContain(' stop');
    expect(log).toContain(' start');
    expect(log).toContain('down -v');

    // 11) 审计包含关键 action
    const actions = await pool.query('SELECT action FROM platform_audit_log ORDER BY id');
    const set = actions.rows.map((r: any) => r.action);
    for (const a of ['tenant.create', 'tenant.provision', 'tenant.quota-set', 'tenant.suspend', 'tenant.resume', 'tenant.renew', 'tenant.terminate']) {
      expect(set).toContain(a);
    }
  });
});
