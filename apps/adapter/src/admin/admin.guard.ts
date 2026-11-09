/** AdminGuard — Basic Auth against DB users + IP whitelist */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '../config/config.service.js';
import { resolveClientIp } from '../common/client-ip.js';
import { ADMIN_ROLE_KEY, ADMIN_USER_KEY, type AdminUserContext } from './admin-roles.js';
import { AdminIdentityService } from './admin-identity.service.js';
import { AdminRequestAuditService, type AuditSurface } from './admin-request-audit.service.js';

function ipToLong(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

function inCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr ?? '32', 10);
  if (range === ip) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly cfg = ConfigService.instance;

  constructor(
    private readonly identity: AdminIdentityService,
    private readonly audit: AdminRequestAuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<
      Request & { [ADMIN_ROLE_KEY]?: string; [ADMIN_USER_KEY]?: AdminUserContext }
    >();
    const res = http.getResponse<Response>();
    const authHeader = req.headers.authorization ?? '';
    if (
      String(req.path ?? req.url ?? '').endsWith('/platform/report') &&
      this.cfg.CONTROL_PLANE_TOKEN &&
      authHeader === `Bearer ${this.cfg.CONTROL_PLANE_TOKEN}`
    ) {
      return true;
    }
    const ip = resolveClientIp(req);
    const allowed = this.cfg.ALLOWED_ADMIN_IPS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.some((cidr) => inCidr(ip, cidr))) {
      this.auditAttempt(req, 403, '');
      throw new HttpException({ errCode: 'AUTH_FORBIDDEN' }, HttpStatus.FORBIDDEN);
    }
    if (!authHeader.startsWith('Basic ')) {
      this.auditAttempt(req, 401, '');
      res.setHeader('WWW-Authenticate', 'Basic');
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    const [user, pass] = Buffer.from(authHeader.slice(6), 'base64').toString('utf8').split(':');
    let authed: AdminUserContext | null = null;
    try {
      authed = await this.identity.authenticate(user ?? '', pass ?? '');
    } catch {
      this.auditAttempt(req, 401, user ?? '');
      res.setHeader('WWW-Authenticate', 'Basic');
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    if (!authed) {
      this.auditAttempt(req, 401, user ?? '');
      res.setHeader('WWW-Authenticate', 'Basic');
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    req[ADMIN_ROLE_KEY] = authed.roleCode;
    req[ADMIN_USER_KEY] = authed;
    return true;
  }

  private auditAttempt(req: Request, status: number, username: string): void {
    const path = String(req.path ?? req.url ?? '').split('?')[0];
    if (path.endsWith('/platform/report') || path.endsWith('/healthz')) return;
    const surface: AuditSurface = path.startsWith('/platform') ? 'platform' : 'admin';
    this.audit.append({
      userId: null,
      username: username.trim().toLowerCase(),
      roleCode: '',
      method: req.method,
      path,
      status,
      costMs: 0,
      clientIp: resolveClientIp(req),
      surface,
    });
  }
}
