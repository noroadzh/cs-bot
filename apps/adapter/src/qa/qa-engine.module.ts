/** QaEngineModule */
import { Module } from '@nestjs/common';
import { MockQaEngine } from './mock-qa.engine.js';
import { FastGPTQaEngine } from './fastgpt-qa.engine.js';
import { ConfigService } from '../config/config.service.js';
import { IQA_ENGINE, type IQAEngine } from '@cs-bot/shared';

@Module({
  providers: [
    {
      provide: IQA_ENGINE,
      useFactory(_config: ConfigService): IQAEngine {
        const cfg = ConfigService.instance;
        return cfg.USE_MOCK_LLM ? new MockQaEngine(cfg.MOCK_QA_FILE) : new FastGPTQaEngine({} as any);
      },
      inject: [ConfigService],
    },
  ],
  exports: [IQA_ENGINE],
})
export class QaEngineModule {}
