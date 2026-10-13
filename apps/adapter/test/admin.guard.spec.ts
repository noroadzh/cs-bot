/**
 * AdminGuard 单元测试
 * 覆盖：IP 白名单（精确 + CIDR）/ IP 不在白名单 403
 *      Basic Auth 缺失 401 / 用户名错误 401 / 密码错误 401 / 正确 200
 *
 * 策略：构造假的 ExecutionContext（只需 switchToHttp().getRequest()），
 * 直接调用 guard.canActivate()，不启动 Nest 容器。
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const ADMIN_USER = 'admin';
const ADMIN_PASSWORD = 'secret123';

const makeCtx = (opts: { ip?: string; authorization?: string }): any => {
  const headers: Record<string, string> = {};
  if (opts.authorization !== undefined) headers.authorization = opts.authorization;
  const req = { ip: opts.ip ?? '127.0.0.1', headers };
  return { switchToHttp: () => ({ getRequest: () => req }) };
};

const basic = (user: string, pass: string): string =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

const statusOf = (fn: () => boolean): number => {
  try {
    fn();
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
    const mod = await import('../src/admin/admin.guard.js');
    // guard 在构造时读取 ConfigService.instance，故必须在 setConfig 之后实例化
    guard = new mod.AdminGuard();
  });

  afterAll(() => resetConfig());

  describe('IP 白名单', () => {
    it('2.9.a 精确 IP 命中白名单 + 正确认证 → 通过', () => {
      const ctx = makeCtx({ ip: '192.168.1.5', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('2.9.b CIDR 命中白名单（10.0.0.7 ∈ 10.0.0.0/24）→ 通过', () => {
      const ctx = makeCtx({ ip: '10.0.0.7', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('2.9.c CIDR 边界：10.0.0.255 ∈ /24 → 通过', () => {
      const ctx = makeCtx({ ip: '10.0.0.255', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('2.9.d IP 不在白名单 → 403 AUTH_FORBIDDEN', () => {
      const ctx = makeCtx({ ip: '172.16.0.1', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(403);
    });

    it('2.9.e CIDR 外相邻 IP（10.0.1.1 ∉ 10.0.0.0/24）→ 403', () => {
      const ctx = makeCtx({ ip: '10.0.1.1', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(403);
    });

    it('2.9.f IPv6 映射前缀 ::ffff:127.0.0.1 被正确剥离', () => {
      // 白名单是 10.0.0.0/24，::ffff:10.0.0.5 应剥离前缀后命中
      const ctx = makeCtx({ ip: '::ffff:10.0.0.5', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('Basic Auth', () => {
    it('2.9.g 白名单内但缺少 Authorization 头 → 401', () => {
      const ctx = makeCtx({ ip: '10.0.0.5' });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('2.9.h Authorization 非 Basic 前缀（Bearer xxx）→ 401', () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: 'Bearer some-token' });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('2.9.i 用户名错误 → 401', () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic('wrong-user', ADMIN_PASSWORD) });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('2.9.j 密码错误 → 401', () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic(ADMIN_USER, 'wrong-pass') });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('2.9.k 用户名与密码同时错误 → 401', () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic('x', 'y') });
      expect(statusOf(() => guard.canActivate(ctx))).toBe(401);
    });

    it('2.9.l 用户名正确密码正确 → 通过', () => {
      const ctx = makeCtx({ ip: '10.0.0.5', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('白名单为空', () => {
    it('2.9.m ALLOWED_ADMIN_IPS 为空 → 跳过 IP 校验，仅校验认证', async () => {
      setConfig({ ALLOWED_ADMIN_IPS: '' });
      const { AdminGuard } = await import('../src/admin/admin.guard.js');
      const g = new AdminGuard();
      // 任意 IP 均放行到认证环节
      expect(statusOf(() => g.canActivate(makeCtx({ ip: '8.8.8.8', authorization: basic(ADMIN_USER, ADMIN_PASSWORD) })))).toBe(200);
      expect(statusOf(() => g.canActivate(makeCtx({ ip: '8.8.8.8' })))).toBe(401);
    });
  });
});