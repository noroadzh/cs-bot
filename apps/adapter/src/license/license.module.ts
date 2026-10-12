import { Module } from '@nestjs/common';
import { LicenseService } from './license.service.js';
import { LicenseGuard } from './license.guard.js';

@Module({
  providers: [LicenseService, LicenseGuard],
  exports: [LicenseService, LicenseGuard],
})
export class LicenseModule {}
