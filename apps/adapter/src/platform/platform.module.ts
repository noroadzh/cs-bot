/**
 * PlatformModule — M11 多租户控制面
 *
 * 控制器始终注册；`PLATFORM_ENABLED=false` 时由 `PlatformEnabledGuard`
 * 在请求期拦截（/platform/* 路由整体 404）。不能在模块定义期读
 * `ConfigService.instance`——那一刻配置尚未初始化，会导致路由永远不挂载。
 */
import { DynamicModule, Module } from '@nestjs/common';
import { promises as fs } from 'node:fs';
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
import { ExportPackager } from './export-package.js';
import { PlatformMonitor, HttpHealthSource } from './platform-monitor.js';
import { UpgradeOrchestrator } from './upgrade-orchestrator.js';
import { ShellUpgradeDeps } from './upgrade-runner.js';
import { TenantOffboarding } from './tenant-offboarding.js';
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
          useFactory: () =>
            new PlatformMonitor(
              new HttpHealthSource(
                ConfigService.instance.DATABASE_URL,
                ConfigService.instance.PLATFORM_HEALTH_URL_TEMPLATE,
              ),
            ),
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
          useFactory: (packager: ExportPackager, tenants: TenantService) =>
            new TenantOffboarding({
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
                await tenants.terminate(tenantId, 'system');
              },
            }),
          inject: [ExportPackager, TenantService],
        },
      ],
      exports: [TenantService, TenantQuotaService, PlatformAuditService],
    };
  }
}
