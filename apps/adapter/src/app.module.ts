/**
 * 根模块
 * 所有子模块在此汇聚；启动顺序逻辑见 main.ts
 */
import { Module, OnModuleInit } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { LicenseModule } from './license/license.module.js';
import { LicenseService } from './license/license.service.js';
import { WecomModule } from './wecom/wecom.module.js';
import { WecomCallbackModule } from './wecom/wecom-callback.module.js';
import { RoutingModule } from './routing/routing.module.js';
import { ContextModule } from './context/context.module.js';
import { QaModule } from './qa/qa.module.js';
import { FilterModule } from './filter/filter.module.js';
import { MissModule } from './miss/miss.module.js';
import { MediaModule } from './media/media.module.js';
import { UsageModule } from './usage/usage.module.js';
import { AdminModule } from './admin/admin.module.js';
import { HealthModule } from './health/health.module.js';
import { ImportModule } from './import/import.module.js';
import { PlatformModule } from './platform/platform.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    LicenseModule,
    WecomModule,
    WecomCallbackModule,
    RoutingModule,
    ContextModule,
    QaModule,
    FilterModule,
    MissModule,
    MediaModule,
    UsageModule,
    AdminModule,
    HealthModule,
    ImportModule,
    PlatformModule.forRoot(),
  ],
})
export class AppModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly licenseService: LicenseService,
  ) {}

  async onModuleInit() {
    // ConfigService 在构造时已完成 fail-fast 校验（见 config.service.ts）
    // LicenseService 启动序：fingerprint → selfcheck → verify → 终态判定
    // production + invalid 时内部 process.exit(1)
    await this.licenseService.startupCheck();
  }
}
