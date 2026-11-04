import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service.js';
import { ArchiveController } from './archive.controller.js';
import { AdminModule } from '../admin/admin.module.js';
import { ImportModule } from '../import/import.module.js';

@Module({
  imports: [AdminModule, ImportModule],
  controllers: [ArchiveController],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
