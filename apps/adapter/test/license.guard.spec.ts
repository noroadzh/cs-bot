/**
 * LicenseGuard 单元测试
 *
 * 对应 src/license/license.guard.ts 的两个分支：
 * - verifyAndCache 返回 valid=true → canActivate 放行（true）
 * - valid=false → 抛 HttpException 403，body 含 errCode=LICENSE_RESTRICTED 与 reason
 */
import { describe, it, expect, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrCode } from '@cs-bot/shared';

function makeGuard(state: { valid: boolean; reason: string; mock?: boolean; daysLeft?: number }) {
  const licenseService = { verifyAndCache: jest.fn(async () => state) } as any;
  // 动态 import 以避免顶层 ConfigService 单例初始化时序问题
  return licenseService;
}

describe('LicenseGuard', () => {
  it('valid=true → canActivate 返回 true，不抛异常', async () => {
    const { LicenseGuard } = await import('../src/license/license.guard.js');
    const guard = new LicenseGuard(makeGuard({ valid: true, reason: 'valid' }));

    await expect(guard.canActivate({} as any)).resolves.toBe(true);
  });

  it('valid=true 且 mock=true（mock 授权）→ 同样放行', async () => {
    const { LicenseGuard } = await import('../src/license/license.guard.js');
    const guard = new LicenseGuard(makeGuard({ valid: true, reason: 'mock', mock: true }));

    await expect(guard.canActivate({} as any)).resolves.toBe(true);
  });

  it('valid=false → 抛 HttpException 403', async () => {
    const { LicenseGuard } = await import('../src/license/license.guard.js');
    const guard = new LicenseGuard(makeGuard({ valid: false, reason: 'expired' }));

    await expect(guard.canActivate({} as any)).rejects.toBeInstanceOf(HttpException);
  });

  it('valid=false → 异常状态码为 403，响应体含 errCode=LICENSE_RESTRICTED 与 reason', async () => {
    const { LicenseGuard } = await import('../src/license/license.guard.js');
    const guard = new LicenseGuard(makeGuard({ valid: false, reason: 'expired-at-2026-01-01' }));

    try {
      await guard.canActivate({} as any);
      throw new Error('预期抛出 HttpException 但未抛出');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const ex = err as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(ex.getResponse()).toEqual({
        errCode: ErrCode.LICENSE_RESTRICTED,
        reason: 'expired-at-2026-01-01',
      });
    }
  });

  it('valid=false → 每次 canActivate 都重新校验（不缓存放行结果）', async () => {
    const { LicenseGuard } = await import('../src/license/license.guard.js');
    const svc = makeGuard({ valid: false, reason: 'invalid' });
    const guard = new LicenseGuard(svc);

    await expect(guard.canActivate({} as any)).rejects.toBeInstanceOf(HttpException);
    await expect(guard.canActivate({} as any)).rejects.toBeInstanceOf(HttpException);

    expect(svc.verifyAndCache).toHaveBeenCalledTimes(2);
  });
});