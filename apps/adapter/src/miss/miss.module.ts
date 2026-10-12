import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MissService } from './miss.service.js';
import { MissExportService } from './miss-export.service.js';
import { MissCleanupService } from './miss-cleanup.service.js';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [MissService, MissExportService, MissCleanupService],
  exports: [MissService, MissExportService],
})
export class MissModule {}
