import { Module } from '@nestjs/common';
import { TriggerService } from './trigger.service.js';
import { DedupService } from './dedup.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { RoutingService } from './routing.service.js';
import { QaModule } from '../qa/qa.module.js';

@Module({
  imports: [QaModule],
  providers: [TriggerService, DedupService, RateLimiterService, RoutingService],
  exports: [RoutingService, TriggerService],
})
export class RoutingModule {}
