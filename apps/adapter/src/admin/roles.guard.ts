import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from './roles.decorator.js';
import type { AdminRole } from './admin-roles.js';
import { ADMIN_ROLE_KEY } from './admin-roles.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<Request & { [ADMIN_ROLE_KEY]?: AdminRole }>();
    const role = req[ADMIN_ROLE_KEY] ?? 'admin';
    if (!required.includes(role)) {
      throw new HttpException({ errCode: 'AUTH_FORBIDDEN', detail: 'role not allowed' }, HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
