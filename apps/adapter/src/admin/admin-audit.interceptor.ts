/** Fail-open request audit for authenticated /admin and /platform calls */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { resolveClientIp } from '../common/client-ip.js';
import { ADMIN_USER_KEY, type AdminUserContext } from './admin-roles.js';
import { AdminRequestAuditService, type AuditSurface } from './admin-request-audit.service.js';

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AdminRequestAuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { [ADMIN_USER_KEY]?: AdminUserContext }>();
    const res = http.getResponse<Response>();
    const started = Date.now();
    const path = String(req.path ?? req.url ?? '').split('?')[0];
    if (path.endsWith('/platform/report') || path.endsWith('/healthz')) {
      return next.handle();
    }
    const user = req[ADMIN_USER_KEY];
    if (!user) return next.handle();
    const surface: AuditSurface = path.startsWith('/platform') ? 'platform' : 'admin';
    return next.handle().pipe(
      tap({
        next: () => this.write(req, res, user, surface, started, path),
        error: () => this.write(req, res, user, surface, started, path),
      }),
    );
  }

  private write(
    req: Request,
    res: Response,
    user: AdminUserContext,
    surface: AuditSurface,
    started: number,
    path: string,
  ): void {
    this.audit.append({
      userId: user.id,
      username: user.username,
      roleCode: user.roleCode,
      method: req.method,
      path,
      status: res.statusCode || 500,
      costMs: Date.now() - started,
      clientIp: resolveClientIp(req),
      surface,
    });
  }
}
