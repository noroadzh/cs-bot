import { Module } from '@nestjs/common';
import { TenantSyncController } from './tenant-sync.controller.js';
import { InstanceFingerprintController } from './instance-fingerprint.controller.js';
import { InternalTokenGuard } from './internal-token.guard.js';

@Module({
  controllers: [TenantSyncController, InstanceFingerprintController],
  providers: [InternalTokenGuard],
})
export class InternalModule {}
