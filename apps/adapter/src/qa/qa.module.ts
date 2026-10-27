import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { QaEngineModule } from './qa-engine.module.js';
import { QaOrchestrator } from './qa-orchestrator.js';
import { ContextModule } from '../context/context.module.js';
import { FilterModule } from '../filter/filter.module.js';
import { MissModule } from '../miss/miss.module.js';
import { MediaModule } from '../media/media.module.js';
import { WecomModule } from '../wecom/wecom.module.js';
import { ApprovedQaService } from './approved-qa.service.js';
import { buildModelRouter } from './model-providers.js';
import type { ModelRouter } from './model-router.js';
import { ConfigService } from '../config/config.service.js';

export const MODEL_ROUTER = 'MODEL_ROUTER';

@Module({
  imports: [QaEngineModule, ContextModule, FilterModule, MissModule, MediaModule, WecomModule],
  providers: [
    {
      provide: MODEL_ROUTER,
      useFactory: (_config: ConfigService) => buildModelRouter(),
      inject: [ConfigService],
    },
    QaOrchestrator,
    ApprovedQaService,
  ],
  exports: [QaOrchestrator],
})
export class QaModule implements OnModuleInit {
  constructor(
    private readonly orchestrator: QaOrchestrator,
    @Inject(MODEL_ROUTER) private readonly router: ModelRouter | null,
  ) {}

  onModuleInit(): void {
    this.orchestrator.setModelRouter(this.router);
  }
}
