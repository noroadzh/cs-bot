/**
 * License 模块：证书校验 + 授权闸门
 *
 * 启动序：LicenseModule.onModuleInit（加载已激活群）
 *        → AppModule.onModuleInit → LicenseService.startupCheck
 * （Nest 模块初始化先于根模块；load 不依赖 license 状态，仅读 PG）
 *
 * 消息路径：WecomController → LicenseGateService.check → RoutingService
 */
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { LicenseService } from './license.service.js';
import { LicenseGuard } from './license.guard.js';
import { LicenseAlertService } from './license-alert.service.js';
import { LicensedChatService } from './licensed-chat.service.js';
import { LicenseGateService } from './license-gate.service.js';
import { TenantGateService } from './tenant-gate.service.js';
import { LicenseRuntimeScheduler } from './license-runtime.scheduler.js';

@Module({
  providers: [
    LicenseService,
    LicenseGuard,
    LicenseAlertService,
    LicensedChatService,
    LicenseGateService,
    TenantGateService,
    LicenseRuntimeScheduler,
  ],
  exports: [
    LicenseService,
    LicenseGuard,
    LicenseAlertService,
    LicensedChatService,
    LicenseGateService,
  ],
})
export class LicenseModule implements OnModuleInit {
  private readonly logger = new Logger('LicenseModule');

  constructor(private readonly licensedChats: LicensedChatService) {}

  async onModuleInit() {
    await this.licensedChats.load();
    this.logger.log(`licensed chats in memory: ${this.licensedChats.getCount()}`);
  }
}
