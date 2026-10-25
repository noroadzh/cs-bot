/**
 * PlatformModule — M11 多租户控制面
 *
 * 控制器始终注册；`PLATFORM_ENABLED=false` 时由 `PlatformEnabledGuard`
 * 在请求期拦截（/platform/* 路由整体 404）。不能在模块定义期读
 * `ConfigService.instance`——那一刻配置尚未初始化，会导致路由永远不挂载。
 */
import { DynamicModule, Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { PlatformController } from './platform.controller.js';
import { TenantService } from './tenant.service.js';
import { TenantQuotaService } from './tenant-quota.service.js';
import { TenantUsageService } from './tenant-usage.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantExpirySweepService } from './tenant-expiry-sweep.service.js';

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
      ],
      exports: [TenantService, TenantQuotaService, PlatformAuditService],
    };
  }
}
