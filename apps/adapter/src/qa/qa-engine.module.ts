/** QaEngineModule */
import { Module } from '@nestjs/common';
import { MockQaEngine } from './mock-qa.engine.js';
import { FastGPTQaEngine } from './fastgpt-qa.engine.js';
import { ConfigService } from '../config/config.service.js';
import { IQA_ENGINE, type IQAEngine } from '@cs-bot/shared';
import { ApprovedQaService } from './approved-qa.service.js';
import { ModelRouterService } from './model-router.service.js';

@Module({
  providers: [
    ApprovedQaService,
    ModelRouterService,
    {
      provide: IQA_ENGINE,
      useFactory(
        _config: ConfigService,
        approvedQa: ApprovedQaService,
        router: ModelRouterService,
      ): IQAEngine {
        const cfg = ConfigService.instance;
        return cfg.USE_MOCK_LLM
          ? new MockQaEngine(cfg.MOCK_QA_FILE)
          : new FastGPTQaEngine(ConfigService as any, approvedQa, undefined, router);
      },
      inject: [ConfigService, ApprovedQaService, ModelRouterService],
    },
  ],
  exports: [IQA_ENGINE, ModelRouterService, ApprovedQaService],
})
export class QaEngineModule {}
