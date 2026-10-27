import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';

/** 内部同步端点鉴权：Bearer TENANT_SYNC_TOKEN */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const expected = ConfigService.instance.TENANT_SYNC_TOKEN;
    const auth = req.headers.authorization ?? '';
    if (!expected) {
      throw new HttpException({ errCode: 'INTERNAL_TOKEN_NOT_CONFIGURED' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (auth !== `Bearer ${expected}`) {
      throw new HttpException({ errCode: 'AUTH_UNAUTHORIZED' }, HttpStatus.UNAUTHORIZED);
    }
    return true;
  }
}
