import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`;

const makeCtx = (peer: string, xff?: string): any => {
  const req = {
    ip: peer,
    socket: { remoteAddress: peer },
    headers: {
      authorization: basic('admin', 'secret123'),
      ...(xff ? { 'x-forwarded-for': xff } : {}),
    },
  };
  return { switchToHttp: () => ({ getRequest: () => req }) };
};

const statusOf = (fn: () => boolean): number => {
  try {
    fn();
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
};

describe('AdminGuard trusted proxy', () => {
  let guard: any;
  beforeAll(async () => {
    setConfig({
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'secret123',
      ALLOWED_ADMIN_IPS: '198.51.100.0/24',
      TRUSTED_PROXY_CIDRS: '172.30.0.0/24',
    });
    const mod = await import('../src/admin/admin.guard.js');
    guard = new mod.AdminGuard();
  });
  afterAll(() => resetConfig());

  it('admits a whitelisted client forwarded by nginx', () => {
    expect(guard.canActivate(makeCtx('172.30.0.2', '198.51.100.9'))).toBe(true);
  });

  it('rejects a non-whitelisted forwarded client', () => {
    expect(statusOf(() => guard.canActivate(makeCtx('172.30.0.2', '203.0.113.9')))).toBe(403);
  });

  it('ignores XFF from an untrusted direct peer', () => {
    expect(statusOf(() => guard.canActivate(makeCtx('203.0.113.9', '198.51.100.9')))).toBe(403);
  });
});
