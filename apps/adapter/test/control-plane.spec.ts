/**
 * 独立控制面：配置校验 + 模块可组装 + report token 鉴权
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ControlPlaneConfigSchema } from '../src/control-plane/control-plane.config.js';
import { ControlPlaneAppModule } from '../src/control-plane/control-plane-app.module.js';
import { PlatformController } from '../src/platform/platform.controller.js';
import { ControlPlaneHealthController } from '../src/control-plane/control-plane-health.controller.js';
import { AdminGuard } from '../src/admin/admin.guard.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot_control',
  ADMIN_PASSWORD: 'admin-test-pwd',
};

describe('ControlPlaneConfig', () => {
  it('最小配置 + 默认端口/平台开关', () => {
    const cfg = ControlPlaneConfigSchema.parse(baseEnv);
    expect(cfg.PORT).toBe(3100);
    expect(cfg.PLATFORM_ENABLED).toBe(true);
    expect(cfg.PLATFORM_TLS_PROVIDER).toBe('file');
  });

  it('缺 DATABASE_URL/ADMIN_PASSWORD → 拒绝', () => {
    expect(ControlPlaneConfigSchema.safeParse({ ADMIN_PASSWORD: '123456' }).success).toBe(false);
    expect(ControlPlaneConfigSchema.safeParse({ DATABASE_URL: 'x' }).success).toBe(false);
  });
});

describe('ControlPlaneAppModule', () => {
  beforeAll(() => setConfig({ PLATFORM_ENABLED: true, CONTROL_PLANE_TOKEN: 'token-1' }));
  afterAll(() => resetConfig());

  it('可独立组装（不加载数据面模块）', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ControlPlaneAppModule] }).compile();
    expect(moduleRef.get(PlatformController)).toBeDefined();
    expect(moduleRef.get(ControlPlaneHealthController)).toBeDefined();
    await moduleRef.close();
  });

  it('/platform/report 接受 CONTROL_PLANE_TOKEN Bearer', () => {
    setConfig({ CONTROL_PLANE_TOKEN: 'token-1' });
    const guard = new AdminGuard();
    const ctx: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/platform/report',
          ip: '203.0.113.9',
          headers: { authorization: 'Bearer token-1' },
        }),
      }),
    };
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('错误 Bearer 且 IP 不在白名单 → 拒绝', () => {
    setConfig({ CONTROL_PLANE_TOKEN: 'token-1', ALLOWED_ADMIN_IPS: '10.0.0.0/8' });
    const guard = new AdminGuard();
    const ctx: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          path: '/platform/report',
          ip: '203.0.113.9',
          headers: { authorization: 'Bearer wrong' },
        }),
      }),
    };
    expect(() => guard.canActivate(ctx)).toThrow();
  });
});
