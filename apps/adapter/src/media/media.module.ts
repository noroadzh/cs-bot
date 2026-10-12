import { Module } from '@nestjs/common';
import { AssetSenderService } from './asset-sender.service.js';
import { WecomModule } from '../wecom/wecom.module.js';

@Module({
  imports: [WecomModule],
  providers: [AssetSenderService],
  exports: [AssetSenderService],
})
export class MediaModule {}
