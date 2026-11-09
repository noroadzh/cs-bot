import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { RolesGuard } from '../src/admin/roles.guard.js';
import { ADMIN_ROLE_KEY } from '../src/admin/admin-roles.js';
import { ROLES_KEY } from '../src/admin/roles.decorator.js';
import { StatsController } from '../src/admin/stats.controller.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('Admin RBAC + stats', () => {
  beforeEach(() => {
    setConfig({
      ADMIN_USER: 'admin',
      ADMIN_PASSWORD: 'secret123',
      ALLOWED_ADMIN_IPS: '127.0.0.1/32',
    });
  });
  afterEach(() => resetConfig());

  it('operator 访问 admin-only reload → 403', () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ['admin'] : undefined),
    };
    const guard = new RolesGuard(reflector as any);
    const req: any = { [ADMIN_ROLE_KEY]: 'operator' };
    expect(() =>
      guard.canActivate({
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({ getRequest: () => req }),
      } as any),
    ).toThrow(HttpException);
  });

  it('stats overview 返回聚合字段', async () => {
    const usage = {
      getUsage: () => ({
        period: 'daily',
        counters: {
          messagesReceived: 10,
          messagesAnswered: 7,
          messagesRefused: 2,
          messagesMissed: 1,
        },
      }),
    };
    const missExport = {
      queryItems: async () => [{ question: 'q1', score: 0.1, chatId: 'c1', status: 0 }],
    };
    const ctl = new StatsController(usage as any, missExport as any);
    const res = await ctl.overview('daily');
    expect(res.messages).toBe(10);
    expect(res.hits).toBe(7);
    expect(res.refusals).toBe(2);
    expect(res.topMiss.length).toBe(1);
    expect(typeof res.hitRate).toBe('number');
  });
});
