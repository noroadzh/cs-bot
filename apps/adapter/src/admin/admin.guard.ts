/** AdminGuard — Basic Auth + IP 白名单；支持 admin / operator 双账号 */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'crypto';
import { ConfigService } from '../config/config.service.js';
import { resolveClientIp } from '../common/client-ip.js';
import { ADMIN_ROLE_KEY, resolveAdminRole, type AdminRole } from './admin-roles.js';

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

function hashEq(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest('hex');
  const bh = createHash('sha256').update(b).digest('hex');
  return ah === bh;
}

@Injectable()
export class AdminGuard implements CanActivate {
  private readonly cfg = ConfigService.instance;

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { [ADMIN_ROLE_KEY]?: AdminRole }>();
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
    const adminOk = hashEq(user ?? '', this.cfg.ADMIN_USER) && hashEq(pass ?? '', this.cfg.ADMIN_PASSWORD);
    const opUser = this.cfg.ADMIN_OPERATOR_USER ?? '';
    const opPass = this.cfg.ADMIN_OPERATOR_PASSWORD ?? '';
    const operatorOk =
      opUser !== '' && opPass !== '' && hashEq(user ?? '', opUser) && hashEq(pass ?? '', opPass);
    if (!adminOk && !operatorOk) {
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    req[ADMIN_ROLE_KEY] = resolveAdminRole(user ?? '', {
      ADMIN_USER: this.cfg.ADMIN_USER ?? 'admin',
      ADMIN_OPERATOR_USER: this.cfg.ADMIN_OPERATOR_USER,
    });
    return true;
  }
}
