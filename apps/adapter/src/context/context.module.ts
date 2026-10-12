import { Module } from '@nestjs/common';
import { ContextService } from './context.service.js';

@Module({
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
