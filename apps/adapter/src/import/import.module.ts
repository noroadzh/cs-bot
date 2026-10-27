import { Module } from '@nestjs/common';
import { ImportController } from './import.controller.js';
import { ImportJobService } from './import-job.service.js';
import { SensitiveRedactor } from './sensitive-redactor.js';
import { ImportCleanupService } from './import-cleanup.service.js';

@Module({
  imports: [],
  controllers: [ImportController],
  providers: [ImportJobService, SensitiveRedactor, ImportCleanupService],
  exports: [ImportJobService],
})
export class ImportModule {}
