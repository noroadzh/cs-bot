import { Module } from '@nestjs/common';
import { WecomController } from './wecom.controller.js';
import { WecomClient } from './wecom-client.js';
import { IMessageSender } from '../qa/message-sender.port.js';

@Module({
  controllers: [WecomController],
  providers: [
    WecomClient,
    { provide: IMessageSender, useExisting: WecomClient },
  ],
  exports: [WecomClient, IMessageSender],
})
export class WecomModule {}
