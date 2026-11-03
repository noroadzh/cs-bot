import { Module } from '@nestjs/common';
import { LearningService } from './learning.service.js';
import { LearningController } from './learning.controller.js';
import { AdminModule } from '../admin/admin.module.js';
import { MissModule } from '../miss/miss.module.js';

@Module({
  imports: [AdminModule, MissModule],
  controllers: [LearningController],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
