import { Module } from '@nestjs/common';
import { WecomClient } from './wecom-client.js';
import { WecomCrypto } from './wecom-crypto.js';
import { IMessageSender } from '../qa/message-sender.port.js';

/**
 * WecomModule 提供 IMessageSender 的实现（WecomClient）。
 * IMessageSender token 定义在 message-sender.port.ts，由 MessageSenderModule 导出。
 */
@Module({
  providers: [
    WecomClient,
    WecomCrypto,
    { provide: IMessageSender, useExisting: WecomClient },
  ],
  exports: [WecomClient, WecomCrypto, IMessageSender],
})
export class WecomModule {}
