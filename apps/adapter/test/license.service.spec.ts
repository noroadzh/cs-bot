/**
 * LicenseService 单元测试
 * 覆盖：USE_MOCK_LICENSE 分支切换、缓存命中、reload
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig, createRedisMock } from './__setup__/test-helpers.js';

const redisMock = createRedisMock();

jest.mock('ioredis', () => ({
  Redis: jest.fn(() => redisMock),
}));

describe('LicenseService', () => {
  beforeEach(() => {
    resetConfig();
    redisMock.store.clear();
  });
  afterEach(() => resetConfig());

  it('2.3.a USE_MOCK_LICENSE=true → mock=true, reason=mock', async () => {
    setConfig({ USE_MOCK_LICENSE: true, LICENSE_FILE: '/tmp/nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.verifyAndCache();
    expect(state.mock).toBe(true);
    expect(state.reason).toBe('mock');
  });

  it('2.3.b USE_MOCK_LICENSE=false → mock=false, reason=native-placeholder', async () => {
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.verifyAndCache();
    expect(state.mock).toBe(false);
    expect(state.reason).toBe('native-placeholder');
  });

  it('2.3.c 缓存命中：二次调用不重跑 verifier', async () => {
    setConfig({ USE_MOCK_LICENSE: true, LICENSE_FILE: '/tmp/nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    await svc.verifyAndCache();
    await redisMock.set('license:cache', JSON.stringify({ valid: true, reason: 'valid', mock: true, daysLeft: 42 }));
    const state = await svc.verifyAndCache();
    expect(state.daysLeft).toBe(42);
  });

  it('2.3.d reload() 先清缓存再重新校验', async () => {
    setConfig({ USE_MOCK_LICENSE: true, LICENSE_FILE: '/tmp/nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    await svc.verifyAndCache();
    await redisMock.set('license:cache', JSON.stringify({ valid: false, reason: 'revoked', mock: true }));
    const state = await svc.reload();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('mock');
  });

  it('2.3.e native 模式不复用 mock 缓存键的 mock 标记', async () => {
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.verifyAndCache();
    expect(state.mock).toBe(false);
  });
});
