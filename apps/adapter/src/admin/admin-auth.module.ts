/** Shared DB-auth + request audit for data-plane and control-plane */
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AdminGuard } from './admin.guard.js';
import { RolesGuard } from './roles.guard.js';
import { AdminIdentityService } from './admin-identity.service.js';
import { AdminRequestAuditService } from './admin-request-audit.service.js';
import { AdminAuditInterceptor } from './admin-audit.interceptor.js';

@Module({
  providers: [
    AdminIdentityService,
    AdminRequestAuditService,
    AdminGuard,
    RolesGuard,
    { provide: APP_INTERCEPTOR, useClass: AdminAuditInterceptor },
  ],
  exports: [AdminIdentityService, AdminRequestAuditService, AdminGuard, RolesGuard],
})
export class AdminAuthModule {}
