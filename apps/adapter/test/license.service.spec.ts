/**
 * LicenseService 单元测试
 *
 * 覆盖 B.5 启动序四步：fingerprint → selfcheck → verify → 终态判定
 * 对应 SPEC license-build M9-Bind-Integration
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const mockSelfcheck = jest.fn(() => ({ clean: true, evidence: [] as string[] }));
const mockNativeVerify = jest.fn(() => ({
  valid: true,
  reason: 'valid',
  mock: false,
  fingerprint: 'fp-native',
  expiresAtMs: Date.now() + 86400000,
  daysLeft: 1,
  maxChats: 100,
}));
const mockFingerprint = jest.fn(() => 'fp-native');

jest.unstable_mockModule('../src/license/native-license.verifier.js', () => ({
  NativeLicenseVerifier: jest.fn(() => ({
    selfcheck: mockSelfcheck,
    verify: mockNativeVerify,
    fingerprint: mockFingerprint,
  })),
}));

describe('LicenseService.startupCheck', () => {
  beforeEach(() => {
    resetConfig();
    mockSelfcheck.mockClear();
    mockSelfcheck.mockReturnValue({ clean: true, evidence: [] });
    mockNativeVerify.mockClear();
    mockNativeVerify.mockReturnValue({
      valid: true,
      reason: 'valid',
      mock: false,
      fingerprint: 'fp-native',
      expiresAtMs: Date.now() + 86400000,
      daysLeft: 1,
      maxChats: 100,
    });
    mockFingerprint.mockClear();
    mockFingerprint.mockReturnValue('fp-native');
  });
  afterEach(() => {
    resetConfig();
    delete process.env.NODE_ENV;
  });

  it('B.5.a mock 模式 + 无 license → valid=false, reason=mock-no-license', async () => {
    setConfig({ USE_MOCK_LICENSE: true, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.startupCheck();
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('mock-no-license');
    expect(state.mock).toBe(true);
  });

  it('B.5.b mock 模式不调用 native selfcheck', async () => {
    setConfig({ USE_MOCK_LICENSE: true, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    await svc.startupCheck();
    expect(mockSelfcheck).not.toHaveBeenCalled();
    expect(mockNativeVerify).not.toHaveBeenCalled();
  });

  it('B.5.c native 模式 selfcheck clean → 继续 verify 并返回 valid', async () => {
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.startupCheck();
    expect(mockSelfcheck).toHaveBeenCalledTimes(1);
    expect(mockNativeVerify).toHaveBeenCalledTimes(1);
    expect(state.valid).toBe(true);
    expect(state.mock).toBe(false);
  });

  it('B.5.d native 模式 selfcheck 不干净 → reason=selfcheck-failed，不调 verify', async () => {
    mockSelfcheck.mockReturnValue({ clean: false, evidence: ['debugger-detected', 'tracerpid-hit'] });
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.startupCheck();
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('selfcheck-failed');
    expect(mockNativeVerify).not.toHaveBeenCalled();
  });

  it('B.5.e native 模式 verify 失败 → 透传 reason', async () => {
    mockNativeVerify.mockReturnValue({
      valid: false,
      reason: 'expired',
      mock: false,
      fingerprint: 'fp-native',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    });
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const state = await svc.startupCheck();
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('expired');
  });

  it('B.5.f getState() 返回 startupCheck 的结果（缓存）', async () => {
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const first = await svc.startupCheck();
    const cached = svc.getState();
    expect(cached).toEqual(first);
    expect(cached.fingerprint).toBe('fp-native');
  });

  it('B.5.g production + !valid → process.exit(1)', async () => {
    process.env.NODE_ENV = 'production';
    mockNativeVerify.mockReturnValue({
      valid: false,
      reason: 'expired',
      mock: false,
      fingerprint: 'fp-native',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    });
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__EXIT__');
    }) as any);
    await expect(svc.startupCheck()).rejects.toThrow('__EXIT__');
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('B.5.h 非 production + !valid → 不 exit，返回 invalid state', async () => {
    delete process.env.NODE_ENV;
    mockNativeVerify.mockReturnValue({
      valid: false,
      reason: 'revoked',
      mock: false,
      fingerprint: 'fp-native',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    });
    setConfig({ USE_MOCK_LICENSE: false, LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { LicenseService } = await import('../src/license/license.service.js');
    const svc = new LicenseService({} as any);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    const state = await svc.startupCheck();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('revoked');
    exitSpy.mockRestore();
  });
});