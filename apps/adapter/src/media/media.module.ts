import { Module } from '@nestjs/common';
import { AssetSenderService } from './asset-sender.service.js';
import { AssetService } from './asset.service.js';
import { AssetReferenceResolver } from './asset-reference.resolver.js';
import { AssetController } from './asset.controller.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { MediaRecognizeService } from './media-recognize.service.js';
import { AsrService } from './asr.service.js';
import { AdminAuthModule } from '../admin/admin-auth.module.js';

@Module({
  imports: [WecomModule, AdminAuthModule],
  controllers: [AssetController],
  providers: [MediaRecognizeService, AsrService, AssetSenderService, AssetService, AssetReferenceResolver],
  exports: [MediaRecognizeService, AsrService, AssetSenderService, AssetService, AssetReferenceResolver],
})
export class MediaModule {}
