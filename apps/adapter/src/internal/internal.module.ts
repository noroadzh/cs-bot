import { Module } from '@nestjs/common';
import { TenantSyncController } from './tenant-sync.controller.js';
import { InternalTokenGuard } from './internal-token.guard.js';

@Module({
  controllers: [TenantSyncController],
  providers: [InternalTokenGuard],
})
export class InternalModule {}
