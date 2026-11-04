/**
 * 数据面内部端点：返回本机 license-native 指纹（控制面开通后回采重签）
 */
import { Controller, Get, HttpException, HttpStatus, UseGuards } from '@nestjs/common';
import { getHostFingerprint } from '../license/host-fingerprint.js';
import { InternalTokenGuard } from './internal-token.guard.js';

@Controller('internal/instance')
@UseGuards(InternalTokenGuard)
export class InstanceFingerprintController {
  @Get('fingerprint')
  fingerprint(): { fingerprint: string } {
    const fp = getHostFingerprint();
    if (!fp) {
      throw new HttpException(
        { errCode: 'INSTANCE_FINGERPRINT_UNAVAILABLE', detail: 'host fingerprint could not be read' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { fingerprint: fp };
  }
}
