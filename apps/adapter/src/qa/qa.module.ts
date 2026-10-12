import { Module } from '@nestjs/common';
import { QaEngineModule } from './qa-engine.module.js';
import { QaOrchestrator } from './qa-orchestrator.js';
import { ContextModule } from '../context/context.module.js';
import { FilterModule } from '../filter/filter.module.js';
import { MissModule } from '../miss/miss.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [QaEngineModule, ContextModule, FilterModule, MissModule, MediaModule],
  providers: [QaOrchestrator],
  exports: [QaOrchestrator],
})
export class QaModule {}
