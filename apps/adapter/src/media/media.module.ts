import { Module } from '@nestjs/common';
import { AssetSenderService } from './asset-sender.service.js';

@Module({
  providers: [AssetSenderService],
  exports: [AssetSenderService],
})
export class MediaModule {}
