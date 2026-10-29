import { Module } from '@nestjs/common';
import { QaEngineModule } from './qa-engine.module.js';
import { QaOrchestrator } from './qa-orchestrator.js';
import { ContextModule } from '../context/context.module.js';
import { FilterModule } from '../filter/filter.module.js';
import { MissModule } from '../miss/miss.module.js';
import { MediaModule } from '../media/media.module.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { ApprovedQaService } from './approved-qa.service.js';
import { LlmAlertService } from './llm-alert.service.js';

@Module({
  imports: [QaEngineModule, ContextModule, FilterModule, MissModule, MediaModule, WecomModule],
  providers: [
    QaOrchestrator,
    ApprovedQaService,
    // 工厂注册：LlmAlertService 的构造参数是可选配置对象，交给 Nest 解析会报错
    { provide: LlmAlertService, useFactory: () => new LlmAlertService() },
  ],
  exports: [QaOrchestrator],
})
export class QaModule {}
