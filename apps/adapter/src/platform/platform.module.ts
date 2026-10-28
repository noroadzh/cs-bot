/**
 * PlatformModule — M11 多租户控制面
 *
 * 控制器始终注册；`PLATFORM_ENABLED=false` 时由 `PlatformEnabledGuard`
 * 在请求期拦截（/platform/* 路由整体 404）。不能在模块定义期读
 * `ConfigService.instance`——那一刻配置尚未初始化，会导致路由永远不挂载。
 */
import { DynamicModule, Module } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join as joinPath } from 'node:path';
import { Pool } from 'pg';
import { join } from 'node:path';
import { AdminGuard } from '../admin/admin.guard.js';
import { ConfigService } from '../config/config.service.js';
import { PlatformController } from './platform.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantQuotaService } from './tenant-quota.service.js';
import { TenantUsageService } from './tenant-usage.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantExpirySweepService } from './tenant-expiry-sweep.service.js';
import { TenantSecretStore } from './tenant-secret-store.js';
import { TenantSecretsService } from './tenant-secrets.service.js';
import { TenantSyncService } from './tenant-sync.service.js';
import { ExportPackager } from './export-package.js';
import { PlatformMonitor, HttpHealthSource } from './platform-monitor.js';
import { UpgradeOrchestrator } from './upgrade-orchestrator.js';
import { ShellUpgradeDeps } from './upgrade-runner.js';
import { TenantOffboarding } from './tenant-offboarding.js';
import { PgOffboardingRepo } from './tenant-offboarding.pg.js';
import { SubscriptionReminder, WebhookNotifier } from './subscription-reminder.js';

@Module({})
export class PlatformModule {
  static forRoot(): DynamicModule {
    return {
      module: PlatformModule,
      imports: [],
      controllers: [PlatformController],
      providers: [
        AdminGuard,
        TenantService,
        TenantSyncService,
        {
          provide: TenantSecretsService,
          useFactory: (store: TenantSecretStore) =>
            new TenantSecretsService(store, ConfigService.instance.PLATFORM_COMPOSE_DIR),
          inject: [TenantSecretStore],
        },
        TenantQuotaService,
        TenantUsageService,
        PlatformAuditService,
        TenantExpirySweepService,
        {
          provide: SubscriptionReminder,
          useFactory: () =>
            new SubscriptionReminder(new WebhookNotifier(ConfigService.instance.OPS_WEBHOOK_URL ?? '')),
        },
        {
          provide: TenantSecretStore,
          useFactory: () =>
            new TenantSecretStore(
              ConfigService.instance.PLATFORM_MASTER_KEY || 'dev-master-key-please-change',
            ),
        },
        {
          provide: ExportPackager,
          useFactory: (store: TenantSecretStore) => new ExportPackager(store),
          inject: [TenantSecretStore],
        },
        {
          provide: PlatformMonitor,
          useFactory: (tenants: TenantService, audit: PlatformAuditService) =>
            new PlatformMonitor(
              new HttpHealthSource(ConfigService.instance.DATABASE_URL, {
                scheme: ConfigService.instance.PLATFORM_INSTANCE_SCHEME ?? 'https',
                verifyTls: ConfigService.instance.PLATFORM_VERIFY_TLS !== false,
                timeoutMs: ConfigService.instance.PLATFORM_INSTANCE_TIMEOUT_MS ?? 8000,
              }),
              (id: string) => tenants.restart(id, 'system:monitor').then(() => undefined),
              audit,
              {
                intervalMs: ConfigService.instance.PLATFORM_MONITOR_INTERVAL_MS,
                failureThreshold: ConfigService.instance.PLATFORM_RESTART_FAILURE_THRESHOLD,
                maxRestartsPerHour: ConfigService.instance.PLATFORM_RESTART_MAX_PER_HOUR,
                listTenants: async () => (await tenants.list()).rows.map((t) => t.id),
              },
            ),
          inject: [TenantService, PlatformAuditService],
        },
        {
          provide: UpgradeOrchestrator,
          useFactory: () =>
            new UpgradeOrchestrator(
              new ShellUpgradeDeps(
                ConfigService.instance.PLATFORM_UPGRADE_SCRIPT,
                120_000,
                ConfigService.instance.PLATFORM_CANARY_OBSERVE_MS,
              ),
              ConfigService.instance.PLATFORM_UPGRADE_CANARY_ID || undefined,
            ),
        },
        {
          provide: TenantOffboarding,
          useFactory: (packager: ExportPackager, tenants: TenantService, audit: PlatformAuditService) => {
            const pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
            return new TenantOffboarding({
              repo: PgOffboardingRepo.fromPool(pool),
              audit,
              exportPackage: async (tenantId: string) => {
                const detail = await tenants.getDetail(tenantId);
                const dir = join(ConfigService.instance.PLATFORM_COMPOSE_DIR, tenantId);
                let assets: string[] = [];
                try {
                  assets = await fs.readdir(join(dir, 'assets'));
                } catch {
                  assets = [];
                }
                const pkg = packager.build({
                  tenantId,
                  knowledgeBase: '',
                  assets,
                  config: JSON.stringify(detail.tenant),
                });
                await fs.mkdir(dir, { recursive: true });
                const out = join(dir, `export-${Date.now()}.enc`);
                await fs.writeFile(out, pkg, { mode: 0o600 });
                return out;
              },
              deleteTenant: async (tenantId: string) => {
                await tenants.terminate(tenantId, 'system:sweep');
                const cfg = ConfigService.instance;
                // compose 目录包含实例 compose、数据卷目录、nginx 证书副本与 secrets.enc
                await fs.rm(joinPath(cfg.PLATFORM_COMPOSE_DIR, tenantId), { recursive: true, force: true });
                await fs.rm(joinPath(cfg.PLATFORM_BACKUP_DIR, tenantId), { recursive: true, force: true });
              },
            });
          },
          inject: [ExportPackager, TenantService, PlatformAuditService],
        },
      ],
      exports: [TenantService, TenantQuotaService, PlatformAuditService],
    };
  }
}
