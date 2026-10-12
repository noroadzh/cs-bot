/** QaEngineModule */
import { Module } from '@nestjs/common';
import { MockQaEngine } from './mock-qa.engine.js';
import { FastGPTQaEngine } from './fastgpt-qa.engine.js';
import { ConfigService } from '../config/config.service.js';
import type { IQAEngine } from '@cs-bot/shared';

@Module({
  providers: [
    {
      provide: IQAEngine,
      useFactory(_config: ConfigService): IQAEngine {
        const cfg = ConfigService.instance;
        return cfg.USE_MOCK_LLM ? new MockQaEngine(cfg.MOCK_QA_FILE) : new FastGPTQaEngine({} as any);
      },
      inject: [ConfigService],
    },
  ],
  exports: [IQAEngine],
})
export class QaEngineModule {}
