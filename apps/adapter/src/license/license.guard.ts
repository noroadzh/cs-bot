/** LicenseGuard */
import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { LicenseService } from './license.service.js';
import { ErrCode } from '@cs-bot/shared';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(private readonly licenseService: LicenseService) {}

  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    // startupCheck 在 onModuleInit 已经执行完毕，此处只读已缓存状态
    const state = this.licenseService.getState();
    if (!state.valid) {
      throw new HttpException(
        { errCode: ErrCode.LICENSE_RESTRICTED, reason: state.reason },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
