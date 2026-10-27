/**
 * 企微回调模块：把 WecomController 独立成模块以打破 WecomModule↔RoutingModule 的循环依赖。
 * WecomController 依赖 WecomClient/WecomCrypto（WecomModule 提供）和 RoutingService（RoutingModule 提供），
 * 将其从两个父模块中剥离并在此组装。
 */
import { Module } from '@nestjs/common';
import { WecomController } from './wecom.controller.js';
import { WecomModule } from './wecom.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { MediaModule } from '../media/media.module.js';
import { LicenseModule } from '../license/license.module.js';
import { MissModule } from '../miss/miss.module.js';

@Module({
  imports: [WecomModule, RoutingModule, MediaModule, LicenseModule, MissModule],
  controllers: [WecomController],
})
export class WecomCallbackModule {}
