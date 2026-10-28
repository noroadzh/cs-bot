/** AdminGuard */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { ConfigService } from '../config/config.service.js';
import { resolveClientIp } from '../common/client-ip.js';

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

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization ?? '';
    // 数据面用量上报：/platform/report 允许 CONTROL_PLANE_TOKEN Bearer 认证
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
      throw new HttpException({ errCode: 'AUTH_FORBIDDEN' }, HttpStatus.FORBIDDEN);
    }
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Basic ')) {
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString('utf8').split(':');
    const userHash = createHash('sha256').update(user).digest('hex');
    const passHash = createHash('sha256').update(pass).digest('hex');
    const expUserHash = createHash('sha256').update(this.cfg.ADMIN_USER).digest('hex');
    const expPassHash = createHash('sha256').update(this.cfg.ADMIN_PASSWORD).digest('hex');
    if (userHash !== expUserHash || passHash !== expPassHash) {
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
