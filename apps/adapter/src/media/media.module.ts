import { Module } from '@nestjs/common';
import { AssetSenderService } from './asset-sender.service.js';
import { AssetService } from './asset.service.js';
import { AssetReferenceResolver } from './asset-reference.resolver.js';
import { AssetController } from './asset.controller.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { MediaRecognizeService } from './media-recognize.service.js';

@Module({
  imports: [WecomModule],
  controllers: [AssetController],
  providers: [MediaRecognizeService, AssetSenderService, AssetService, AssetReferenceResolver],
  exports: [MediaRecognizeService, AssetSenderService, AssetService, AssetReferenceResolver],
})
export class MediaModule {}
