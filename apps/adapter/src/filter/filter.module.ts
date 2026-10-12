import { Module } from '@nestjs/common';
import { SensitiveFilterService } from './sensitive-filter.service.js';

@Module({
  providers: [SensitiveFilterService],
  exports: [SensitiveFilterService],
})
export class FilterModule {}
