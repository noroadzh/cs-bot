/**
 * AdminGuard：IP 白名单 + DB Basic Auth（stub identity）
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'secret123';

const makeCtx = (opts: { ip?: string; authorization?: string; path?: string }): any => {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  const req = {
    ip: opts.ip ?? '127.0.0.1',
    headers,
    path: opts.path ?? '/admin/license',
    url: opts.path ?? '/admin/license',
    method: 'GET',
  };
  const res = { setHeader: jest.fn() };
  return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
};

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

const statusOf = async (fn: () => Promise<boolean>): Promise<number> => {
  try {
    await fn();
    return 200;
  } catch (e) {
    return (e as HttpException).getStatus();
  }
};

describe('AdminGuard', () => {
  let guard: any;

  beforeAll(async () => {
    setConfig({
      ALLOWED_ADMIN_IPS: '10.0.0.0/24,192.168.1.5',
      ADMIN_USER,
      ADMIN_PASSWORD,
    });
    const identity = {
      authenticate: jest.fn(async (user: string, pass: string) => {
        if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
          return { id: 'u1', username: ADMIN_USER, roleCode: 'admin' as const };
        }
        if (user === 'ops' && pass === 'op-secret') {
          return { id: 'u2', username: 'ops', roleCode: 'operator' as const };
        }
        return null;
      }),
    };
    const audit = { append: jest.fn() };
    const mod = await import('../src/admin/admin.guard.js');
    guard = new mod.AdminGuard(identity as any, audit as any);
  });

  afterAll(() => resetConfig());

  describe('IP 白名单', () => {
    it('精确 IP 命中白名单 + 正确认证 → 通过', async () => {
      const ctx = makeCtx({ ip: '192.168.1.5', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('CIDR 命中白名单 → 通过', async () => {
      const ctx = makeCtx({ ip: '10.0.0.7', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('IP 不在白名单 → 403', async () => {
      const ctx = makeCtx({ ip: '172.16.0.1', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(await statusOf(() => guard.canActivate(ctx))).toBe(403);
    });
  });

  describe('DB Basic Auth', () => {
    it('正确库用户 → 通过并挂载角色', async () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(await guard.canActivate(ctx)).toBe(true);
      const req = ctx.switchToHttp().getRequest();
      expect(req.adminRole).toBe('admin');
      expect(req.adminUser.username).toBe(ADMIN_USER);
    });

    it('operator 库用户 → operator 角色', async () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic('ops', 'op-secret') });
      expect(await guard.canActivate(ctx)).toBe(true);
      expect(ctx.switchToHttp().getRequest().adminRole).toBe('operator');
    });

    it('密码错误 → 401', async () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic(ADMIN_USER, 'wrong') });
      expect(await statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('仅 env 账号且库无此用户 → 401', async () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic('env-only', ADMIN_PASSWORD) });
      expect(await statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('缺少 Authorization → 401', async () => {
      const ctx = makeCtx({ ip: '10.0.0.5' });
      expect(await statusOf(() => guard.canActivate(ctx))).toBe(401);
    });
  });
});
