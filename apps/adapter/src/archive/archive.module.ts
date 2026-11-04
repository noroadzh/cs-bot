import { Module } from '@nestjs/common';
import { ArchiveService } from './archive.service.js';
import { ArchiveController } from './archive.controller.js';
import { WecomSessionArchiveClient } from './wecom-session-archive.client.js';
import { AdminModule } from '../admin/admin.module.js';
import { ImportModule } from '../import/import.module.js';
import { OpsAlertService } from '../common/ops-alert.service.js';

@Module({
  imports: [AdminModule, ImportModule],
  controllers: [ArchiveController],
  providers: [
    { provide: OpsAlertService, useFactory: () => new OpsAlertService() },
    WecomSessionArchiveClient,
    ArchiveService,
  ],
  exports: [ArchiveService],
})
export class ArchiveModule {}
