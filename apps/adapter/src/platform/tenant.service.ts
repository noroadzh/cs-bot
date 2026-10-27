/**
 * TenantService — M11 租户生命周期编排（spec tenant-registry, design D1/D2）
 *
 * Endpoints: create, provision, renew, suspend, resume, terminate, list, getDetail
 * Each success writes one audit entry per the spec's action vocabulary.
 */

import {
  Injectable,
  Optional,
  OnModuleDestroy,
  HttpException,
  HttpStatus,
  ConflictException,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Pool, types } from 'pg';
import { randomUUID } from 'crypto';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantQuotaService, DEFAULT_QUOTA } from './tenant-quota.service.js';
import { TenantUsageService } from './tenant-usage.service.js';
import { TenantStateMachine } from './tenant.state-machine.js';
import type { TenantProvisioner } from './provisioner/provisioner.js';
import type { TenantSecretsService } from './tenant-secrets.service.js';
import { ShellProvisioner } from './provisioner/shell-provisioner.js';
import {
  type CertificateProvider,
  type LicenseIssuer,
  CommandCertificateProvider,
  FakeCertificateProvider,
  FileCertificateProvider,
  NoopLicenseIssuer,
  ShellLicenseIssuer,
} from './certificate-provider.js';
import type {
  Tenant,
  TenantCreateInput,
  TenantDetail,
  TenantListResult,
  TenantQuota,
} from './tenant.entity.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function selectCertificateProvider(cfg: typeof ConfigService.instance): CertificateProvider {
  switch (cfg.PLATFORM_TLS_PROVIDER) {
    case 'fake':
      return new FakeCertificateProvider();
    case 'file':
      return new FileCertificateProvider(cfg.PLATFORM_CERT_DIR);
    case 'acme':
    case 'command':
      if (!cfg.PLATFORM_CERT_CMD) {
        throw new Error('PLATFORM_CERT_CMD is required when PLATFORM_TLS_PROVIDER=acme|command');
      }
      return new CommandCertificateProvider(cfg.PLATFORM_CERT_CMD, cfg.PLATFORM_CERT_DIR);
    default:
      throw new Error(
        `unsupported PLATFORM_TLS_PROVIDER="${cfg.PLATFORM_TLS_PROVIDER}" (supported: file, acme, command, fake)`,
      );
  }
}

function selectLicenseIssuer(cfg: typeof ConfigService.instance): LicenseIssuer {
  switch (cfg.LICENSE_ISSUER) {
    case 'noop':
      return new NoopLicenseIssuer();
    case 'shell':
      return new ShellLicenseIssuer(cfg.LICENSE_ISSUER_BIN, cfg.LICENSE_ISSUER_KEY, cfg.LICENSE_ISSUER_OUT_DIR);
    default:
      throw new Error(`unsupported LICENSE_ISSUER="${cfg.LICENSE_ISSUER}" (supported: shell, noop)`);
  }
}

@Injectable()
export class TenantService implements OnModuleDestroy {
  private readonly logger = new AppLogger('TenantService');
  private readonly pool: Pool;
  private provisioner: TenantProvisioner;

  constructor(
    private readonly audit: PlatformAuditService,
    private readonly quota: TenantQuotaService,
    private readonly usage: TenantUsageService,
    _config: ConfigService,
    @Optional() private readonly secrets?: TenantSecretsService,
  ) {
    this.pool = new Pool({
      connectionString: ConfigService.instance.DATABASE_URL,
      max: 5,
    });
    // Default: ShellProvisioner; tests can substitute
    this.provisioner = new ShellProvisioner(ConfigService.instance);

    const cfg = ConfigService.instance;
    if (cfg.PLATFORM_ENABLED && process.env.NODE_ENV === 'production') {
      if (cfg.PLATFORM_TLS_PROVIDER === 'fake') {
        throw new Error('PLATFORM_TLS_PROVIDER=fake is not allowed when PLATFORM_ENABLED in production');
      }
      if (cfg.LICENSE_ISSUER === 'noop') {
        throw new Error('LICENSE_ISSUER=noop is not allowed when PLATFORM_ENABLED in production');
      }
    }
    this.certProvider = selectCertificateProvider(cfg);
    this.licenseIssuer = selectLicenseIssuer(cfg);
  }

  private certProvider: CertificateProvider;
  private licenseIssuer: LicenseIssuer;

  setCertificateProvider(p: CertificateProvider): void {
    this.certProvider = p;
  }

  setLicenseIssuer(p: LicenseIssuer): void {
    this.licenseIssuer = p;
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(input: TenantCreateInput, actor = 'system'): Promise<Tenant> {
    if (!input.name || input.name.trim() === '') {
      throw new BadRequestException({
        errCode: 'TENANT_NAME_EMPTY',
        detail: 'name is required and must be non-empty',
        field: 'name',
      });
    }

    const trimmedName = input.name.trim();
    // Check duplicate name among non-terminated tenants
    const dupRes = await this.pool.query(
      `SELECT id FROM tenant WHERE name = $1 AND status <> 'terminated' AND deleted_at IS NULL`,
      [trimmedName],
    );
    if (dupRes.rows.length > 0) {
      throw new ConflictException({
        errCode: 'TENANT_NAME_DUPLICATE',
        detail: `tenant name "${trimmedName}" already exists`,
      });
    }

    const now = new Date();
    const expiredAt = input.subscriptionExpiresAt
      ? new Date(input.subscriptionExpiresAt).toISOString()
      : new Date(now.getTime() + 365 * 86_400_000).toISOString();

    const res = await this.pool.query(
      `INSERT INTO tenant (id, name, status, host, port, database_url, created_at, updated_at, expired_at, last_provision_log, deleted_at)
       VALUES ($1, $2, 'created', $3, nextval('tenant_port_seq'), NULL, $4, $4, $5, NULL, NULL)
       RETURNING id, name, status, host, port, database_url, created_at, updated_at, expired_at, last_provision_log, deleted_at`,
      [randomUUID(), trimmedName, input.domain ?? null, now.toISOString(), expiredAt],
    );

    const tenant = mapTenantRow(res.rows[0]);

    // Default quota
    await this.quota.ensureDefaultQuota(tenant.id);

    // Audit tenant.create
    await this.audit.append({
      action: 'tenant.create',
      actor,
      tenantId: tenant.id,
      payload: {
        tenantId: tenant.id,
        name: tenant.name,
        plan: input.plan ?? null,
        subscriptionExpiresAt: tenant.expiredAt,
      },
    });

    this.logger.log({ detail: 'tenant-create', tenantId: tenant.id, plan: input.plan });
    return tenant;
  }

  // -------------------------------------------------------------------------
  // Provision
  // -------------------------------------------------------------------------

  async provision(tenantId: string, actor = 'system'): Promise<Tenant> {
    const provisionStart = Date.now();
    const tenant = await this.requireTenant(tenantId);

    // Assert created → provisioning
    TenantStateMachine.assertTransition(tenant.status, 'provisioning');

    // Update to provisioning in DB
    await this.pool.query(
      `UPDATE tenant SET status = 'provisioning', updated_at = NOW() WHERE id = $1`,
      [tenantId],
    );

    try {
      if (!tenant.port) {
        const portRes = await this.pool.query(`SELECT nextval('tenant_port_seq') AS port`);
        tenant.port = Number(portRes.rows[0]?.port ?? 30000);
      }
      const quotaForSeed = await this.quota.getQuota(tenantId);
      // 密钥与 env（幂等）；渲染器只消费 tenant.env
      const secretsResult = await this.secrets?.ensure(tenantId);
      const missingSecrets = (await this.secrets?.missingRequired(tenantId)) ?? [];
      if (missingSecrets.length > 0) {
        throw new BadRequestException({
          errCode: 'TENANT_SECRETS_MISSING',
          detail: 'tenant WeCom secrets are required before provisioning',
          missing: missingSecrets,
        });
      }
      const envFile = secretsResult?.envFile
        ?? `${ConfigService.instance.PLATFORM_COMPOSE_DIR}/${tenantId}/tenant.env`;
      await this.provisioner.render(tenant, envFile);
      await this.writeTenantSeed(tenant, quotaForSeed);
      // TLS 证书（失败 → 回滚 + provisioning_failed），落盘供 nginx 使用
      const cert = await this.certProvider.issue(tenant.host ?? tenant.id);
      await this.writeCertFiles(tenantId, cert);
      // 订阅期授权（必须在实例启动前落盘，否则 production 启动强校验会退出）
      const quota = quotaForSeed;
      await this.licenseIssuer.issue({
        id: tenant.id,
        host: tenant.host,
        fingerprint: ConfigService.instance.PLATFORM_LICENSE_FINGERPRINT || undefined,
        expiresAtMs: tenant.expiredAt ? Date.parse(tenant.expiredAt) : Date.now() + 365 * 86_400_000,
        maxChats: quota?.maxChats,
      });
      // Up
      await this.provisioner.up(tenant);
      // Probe
      const timeoutMs = ConfigService.instance.PLATFORM_PROVISION_TIMEOUT_MS;
      const healthy = await this.provisioner.probe(tenant, timeoutMs);

      if (!healthy) {
        // Probe timeout → down + provisioning_failed
        try {
          await this.provisioner.down(tenant, false);
        } catch {
          // best-effort cleanup; ignore
        }
        await this.pool.query(
          `UPDATE tenant SET status = 'provisioning_failed', last_provision_log = 'probe timeout', updated_at = NOW()
           WHERE id = $1`,
          [tenantId],
        );
        await this.audit.append({
          action: 'tenant.provision',
          actor,
          tenantId,
          payload: { tenantId, error: 'probe timeout' },
        });
        throw new InternalServerErrorException({
          errCode: 'TENANT_PROVISION_TIMEOUT',
          detail: 'health probe timed out after ' + timeoutMs + 'ms',
        });
      }

      // Success → active
      this.logger.timing({ detail: 'tenant-provision', tenantId, status: 'active' }, Date.now() - provisionStart);
      await this.pool.query(
        `UPDATE tenant SET status = 'active', host = $2, port = $3, database_url = $4,
                tls_cert_ref = $5, secrets_ref = $6, updated_at = NOW()
         WHERE id = $1`,
        [tenantId, tenant.host, tenant.port, tenant.databaseUrl, `${ConfigService.instance.PLATFORM_COMPOSE_DIR}/${tenantId}/nginx/certs`, secretsResult?.secretsRef ?? null],
      );
      await this.audit.append({
        action: 'tenant.provision',
        actor,
        tenantId,
        payload: { tenantId, instanceHost: tenant.host, instancePort: tenant.port, composeFilePath: provisionerPath(tenantId) },
      });

      return this.requireTenant(tenantId);
    } catch (err) {
      // On compose command failure → provisioning_failed
      this.logger.error({ detail: 'tenant-provision-failed', tenantId, err: (err as Error).message });
      const errorMsg = (err as Error).message || 'unknown provision error';
      // Best-effort down (do not drop volumes yet — provisioning may retry)
      try {
        await this.provisioner.down(tenant, false);
      } catch {
        // ignore
      }
      await this.pool.query(
        `UPDATE tenant SET status = 'provisioning_failed', last_provision_log = $2, updated_at = NOW()
         WHERE id = $1`,
        [tenantId, errorMsg.slice(0, 5000)],
      );
      await this.audit.append({
        action: 'tenant.provision',
        actor,
        tenantId,
        payload: { tenantId, error: errorMsg.slice(0, 500) },
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Renew
  // -------------------------------------------------------------------------

  async renew(tenantId: string, days: number, actor = 'system'): Promise<Tenant> {
    const tenant = await this.requireTenant(tenantId);

    const fromStatus = tenant.status;
    // Renew allowed from active or grace
    if (fromStatus !== 'active' && fromStatus !== 'grace') {
      throw new HttpException(
        {
          errCode: 'TENANT_RENEW_FORBIDDEN',
          detail: `renew not allowed from status "${fromStatus}"`,
          currentStatus: fromStatus,
        },
        HttpStatus.CONFLICT,
      );
    }

    if (!Number.isInteger(days) || days < 1) {
      throw new BadRequestException({
        errCode: 'TENANT_RENEW_INVALID',
        detail: 'days must be a positive integer',
      });
    }

    const beforeExpiresAt = tenant.expiredAt
      ? new Date(tenant.expiredAt).toISOString()
      : null;
    // spec「Renewal extends subscription」：在现有 expired_at 基础上累加 days
    // （例：10 天后到期 + renew 90 天 → 100 天后到期）；无 expired_at 时从 now 起算
    const baseMs = beforeExpiresAt ? new Date(beforeExpiresAt).getTime() : Date.now();
    const afterExpiresAt = new Date(
      baseMs + days * 86_400_000,
    ).toISOString();

    // If grace → active, assert transition
    const toStatus: string = fromStatus === 'grace' ? 'active' : fromStatus;
    if (toStatus !== fromStatus) {
      TenantStateMachine.assertTransition(fromStatus, toStatus as import('./tenant.entity.js').TenantStatus);
    }

    await this.pool.query(
      `UPDATE tenant SET expired_at = $2, status = $3, updated_at = NOW() WHERE id = $1`,
      [tenantId, afterExpiresAt, toStatus],
    );

    await this.audit.append({
      action: 'tenant.renew',
      actor,
      tenantId,
      payload: {
        tenantId,
        days,
        beforeExpiresAt: beforeExpiresAt ?? null,
        afterExpiresAt,
      },
    });

    return this.requireTenant(tenantId);
  }

  // -------------------------------------------------------------------------
  // Suspend
  // -------------------------------------------------------------------------

  async suspend(tenantId: string, actor = 'system'): Promise<Tenant> {
    const tenant = await this.requireTenant(tenantId);

    // Spec: suspend allowed from active or grace only; result status = paused
    if (tenant.status !== 'active' && tenant.status !== 'grace') {
      throw new HttpException(
        {
          errCode: 'TENANT_SUSPEND_FORBIDDEN',
          detail: `suspend not allowed from status "${tenant.status}"`,
          currentStatus: tenant.status,
          action: 'suspend',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Assert transition (state machine allows active|grace → paused)
    TenantStateMachine.assertTransition(tenant.status, 'paused');

    await this.pool.query(
      `UPDATE tenant SET status = 'paused', updated_at = NOW() WHERE id = $1`,
      [tenantId],
    );

    // docker compose stop (best-effort; if no compose dir yet, skip)
    try {
      await this.provisioner.stop(tenant);
    } catch {
      // ignore: compose dir may not exist for created tenants
    }

    await this.audit.append({
      action: 'tenant.suspend',
      actor,
      tenantId,
      payload: { tenantId },
    });

    return this.requireTenant(tenantId);
  }

  // -------------------------------------------------------------------------
  // Resume
  // -------------------------------------------------------------------------

  async resume(tenantId: string, actor = 'system'): Promise<Tenant> {
    const tenant = await this.requireTenant(tenantId);

    // Spec: resume allowed only from paused
    if (tenant.status !== 'paused') {
      throw new HttpException(
        {
          errCode: 'TENANT_RESUME_FORBIDDEN',
          detail: `resume not allowed from status "${tenant.status}"`,
          currentStatus: tenant.status,
          action: 'resume',
        },
        HttpStatus.CONFLICT,
      );
    }

    TenantStateMachine.assertTransition('paused', 'active');

    await this.pool.query(
      `UPDATE tenant SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [tenantId],
    );

    try {
      await this.provisioner.start(tenant);
    } catch {
      // ignore; instance may need re-provision
    }

    await this.audit.append({
      action: 'tenant.resume',
      actor,
      tenantId,
      payload: { tenantId },
    });

    return this.requireTenant(tenantId);
  }

  // -------------------------------------------------------------------------
  // Terminate
  // -------------------------------------------------------------------------

  async terminate(tenantId: string, actor = 'system'): Promise<Tenant> {
    // includeDeleted：已终止的租户被软删后，二次 terminate 仍需幂等返回
    const tenant = await this.requireTenant(tenantId, true);

    // Idempotent: already terminated → return as-is
    if (tenant.status === 'terminated') {
      return tenant;
    }

    // Assert transition (state machine allows all non-terminal → terminated)
    TenantStateMachine.assertTransition(tenant.status, 'terminated');

    const droppedDatabase = !!tenant.databaseUrl;

    // docker compose down -v (best-effort)
    try {
      await this.provisioner.down(tenant, true);
    } catch {
      // ignore
    }

    // DROP DATABASE (best-effort)
    if (droppedDatabase) {
      const dbName = extractDbName(tenant.databaseUrl!);
      const conn = await this.pool.connect().catch(() => null);
      if (conn && dbName) {
        try {
          // 只终止该租户库的连接，绝不能动适配层自身库
          await conn.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [dbName],
          );
          await conn.query(`DROP DATABASE IF EXISTS "${dbName.replace(/"/g, '""')}"`);
        } catch {
          // ignore DROP DATABASE failures
        } finally {
          conn.release();
        }
      } else {
        conn?.release();
      }
    }

    await this.pool.query(
      `UPDATE tenant SET status = 'terminated', deleted_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [tenantId],
    );

    await this.audit.append({
      action: 'tenant.terminate',
      actor,
      tenantId,
      payload: { tenantId, droppedDatabase },
    });

    // 已软删（deleted_at 非空），返回时需 includeDeleted
    return this.requireTenant(tenantId, true);
  }

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  async list(status?: string, limit = DEFAULT_LIMIT, offset = 0): Promise<TenantListResult> {
    const cappedLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const params: unknown[] = [];
    const whereClauses: string[] = ['deleted_at IS NULL'];

    if (status) {
      whereClauses.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    const whereStr = whereClauses.join(' AND ');

    const countRes = await this.pool.query(
      `SELECT COUNT(*) AS cnt FROM tenant WHERE ${whereStr}`,
      params,
    );
    const total = Number(countRes.rows[0].cnt);

    const dataRes = await this.pool.query(
      `SELECT id, name, status, host, port, database_url, created_at, updated_at,
              expired_at, last_provision_log, deleted_at
       FROM tenant WHERE ${whereStr}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, cappedLimit, offset],
    );

    return {
      total,
      limit: cappedLimit,
      offset,
      rows: dataRes.rows.map(mapTenantRow),
    };
  }

  // -------------------------------------------------------------------------
  // Get Detail (tenant + quota + today usage)
  // -------------------------------------------------------------------------

  async getDetail(tenantId: string): Promise<TenantDetail> {
    const tenant = await this.requireTenant(tenantId);
    const quota = await this.quota.getQuota(tenantId);
    const usageToday = await this.usage.todaySummary(tenantId);
    return { tenant, quota, usageToday };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async requireTenant(id: string, includeDeleted = false): Promise<Tenant> {
    const res = await this.pool.query(
      `SELECT id, name, status, host, port, database_url, created_at, updated_at,
              expired_at, last_provision_log, deleted_at
       FROM tenant WHERE id = $1${includeDeleted ? '' : ' AND deleted_at IS NULL'}`,
      [id],
    );
    if (res.rows.length === 0) {
      throw new NotFoundException({
        errCode: 'TENANT_NOT_FOUND',
        detail: `tenant ${id} not found`,
      });
    }
    return mapTenantRow(res.rows[0]);
  }

  /** Allow tests to inject a custom provisioner */
  setProvisioner(p: TenantProvisioner): void {
    this.provisioner = p;
  }

  /** 租户实例 DB 初始化种子：本租户状态与配额（供数据面 TenantGate 本地准入） */
  private async writeTenantSeed(tenant: Tenant, quota: TenantQuota | null): Promise<void> {
    const esc = (v: string | null | undefined) => (v ?? '').replace(/'/g, "''");
    const dir = `${ConfigService.instance.PLATFORM_COMPOSE_DIR}/${tenant.id}/initdb`;
    const sql = [
      `INSERT INTO tenant (id, name, status, host, port, expired_at, created_at, updated_at)`,
      `VALUES ('${tenant.id}', '${esc(tenant.name)}', 'active', '${esc(tenant.host)}', ${tenant.port ?? 0},`,
      `        ${tenant.expiredAt ? `'${esc(tenant.expiredAt)}'` : 'NULL'}, NOW(), NOW())`,
      `ON CONFLICT (id) DO NOTHING;`,
      `INSERT INTO tenant_quota (tenant_id, max_chats, max_storage_mb, max_api_calls, max_users, max_llm_tokens_per_month)`,
      `VALUES ('${tenant.id}', ${quota?.maxChats ?? 5}, ${quota?.maxStorageMb ?? 2048}, ${quota?.maxApiCalls ?? 5000}, ${quota?.maxUsers ?? 2}, ${quota?.maxLlmTokensPerMonth ?? 0})`,
      `ON CONFLICT (tenant_id) DO NOTHING;`,
      '',
    ].join('\n');
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/99-tenant-seed.sql`, sql, { mode: 0o644 });
  }

  private async writeCertFiles(tenantId: string, cert: { cert: string; key: string }): Promise<void> {
    const dir = `${ConfigService.instance.PLATFORM_COMPOSE_DIR}/${tenantId}/nginx/certs`;
    const fs = await import('node:fs/promises');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/fullchain.pem`, cert.cert, { mode: 0o644 });
    await fs.writeFile(`${dir}/privkey.pem`, cert.key, { mode: 0o600 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

}

function mapTenantRow(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as Tenant['status'],
    host: row.host === null || row.host === undefined ? null : String(row.host),
    port: row.port === null || row.port === undefined ? null : Number(row.port),
    databaseUrl:
      row.database_url === null || row.database_url === undefined
        ? null
        : String(row.database_url),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    expiredAt:
      row.expired_at === null || row.expired_at === undefined
        ? null
        : new Date(row.expired_at as string).toISOString(),
    lastProvisionLog:
      row.last_provision_log === null || row.last_provision_log === undefined
        ? null
        : String(row.last_provision_log),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(row.deleted_at as string).toISOString(),
  };
}

function provisionerPath(tenantId: string): string {
  return ConfigService.instance.PLATFORM_COMPOSE_DIR + '/' + tenantId + '/docker-compose.yml';
}

/**
 * 从 database_url 解析库名：既兼容连接串（postgresql://.../dbname），
 * 也兼容直接给库名的旧数据。
 */
function extractDbName(databaseUrl: string): string {
  if (databaseUrl.includes('://')) {
    try {
      return new URL(databaseUrl).pathname.replace(/^\//, '');
    } catch {
      return '';
    }
  }
  return databaseUrl;
}
