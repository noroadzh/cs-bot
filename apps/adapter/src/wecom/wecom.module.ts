import { Module } from '@nestjs/common';
import { WecomClient } from './wecom-client.js';
import { WecomCrypto } from './wecom-crypto.js';
import { IMessageSender } from '../qa/message-sender.port.js';
import { ConfigService } from '../config/config.service.js';
import { UsageService } from '../usage/usage.service.js';
import { OpsAlertService } from '../common/ops-alert.service.js';

/**
 * WecomModule 提供 IMessageSender 的实现（WecomClient）。
 * IMessageSender token 定义在 message-sender.port.ts，由 MessageSenderModule 导出。
 */
@Module({
  providers: [
    {
      provide: WecomClient,
      useFactory: (cfg: ConfigService, usage: UsageService) => new WecomClient(cfg, usage),
      inject: [ConfigService, UsageService],
    },
    WecomCrypto,
    // OpsAlertService 的构造参数是可选配置对象，用工厂注册避免 Nest 解析
    { provide: OpsAlertService, useFactory: () => new OpsAlertService() },
    { provide: IMessageSender, useExisting: WecomClient },
  ],
  exports: [WecomClient, WecomCrypto, IMessageSender],
})
export class WecomModule {}
