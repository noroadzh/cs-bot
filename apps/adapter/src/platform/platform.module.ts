/**
 * PlatformModule — M11 多租户控制面
 *
 * 控制器始终注册；`PLATFORM_ENABLED=false` 时由 `PlatformEnabledGuard`
 * 在请求期拦截（/platform/* 路由整体 404）。不能在模块定义期读
 * `ConfigService.instance`——那一刻配置尚未初始化，会导致路由永远不挂载。
 */
import { DynamicModule, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { ConfigService } from '../config/config.service.js';
import { PlatformController } from './platform.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantQuotaService } from './tenant-quota.service.js';
import { TenantUsageService } from './tenant-usage.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantExpirySweepService } from './tenant-expiry-sweep.service.js';
import { TenantSecretStore } from './tenant-secret-store.js';
import { ExportPackager } from './export-package.js';
import { PlatformMonitor } from './platform-monitor.js';
import { UpgradeOrchestrator } from './upgrade-orchestrator.js';
import { TenantOffboarding } from './tenant-offboarding.js';

@Module({})
export class PlatformModule {
  static forRoot(): DynamicModule {
    return {
      module: PlatformModule,
      imports: [AdminModule],
      controllers: [PlatformController],
      providers: [
        TenantService,
        TenantQuotaService,
        TenantUsageService,
        PlatformAuditService,
        TenantExpirySweepService,
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
            new PlatformMonitor({
              probe: async (id: string) => ({
                tenantId: id,
                healthy: true,
                qaFailRate: 0,
                llmFailRate: 0,
              }),
            }),
        },
        {
          provide: UpgradeOrchestrator,
          useFactory: () =>
            new UpgradeOrchestrator(
              {
                snapshot: async () => undefined,
                swapImage: async () => undefined,
                health: async () => true,
                rollback: async () => undefined,
                observe: async () => true,
              },
              ConfigService.instance.PLATFORM_UPGRADE_CANARY_ID || undefined,
            ),
        },
        {
          provide: TenantOffboarding,
          useFactory: (packager: ExportPackager) =>
            new TenantOffboarding({
              exportPackage: async (tenantId: string) => {
                void packager;
                return `data/tenants/${tenantId}/export.enc`;
              },
              deleteTenant: async () => undefined,
            }),
          inject: [ExportPackager],
        },
      ],
      exports: [TenantService, TenantQuotaService, PlatformAuditService],
    };
  }
}
