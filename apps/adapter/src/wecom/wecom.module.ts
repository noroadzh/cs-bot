import { Module } from '@nestjs/common';
import { WecomController } from './wecom.controller.js';
import { WecomClient } from './wecom-client.js';

@Module({
  controllers: [WecomController],
  providers: [WecomClient],
  exports: [WecomClient],
})
export class WecomModule {}
