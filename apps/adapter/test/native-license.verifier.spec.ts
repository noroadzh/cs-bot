/**
 * NativeLicenseVerifier 单元测试
 * 覆盖分支：native 未加载、bad-format、native-error、fingerprint-mismatch、antireplay 失败/通过
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// mock 状态对象（jest 提升后仍可通过此引用控制）
const mockNative = {
  fingerprint: jest.fn<() => string | null>(() => 'host-fp-123'),
  selfcheck: jest.fn<() => { clean: boolean; evidence: string[] }>(() => ({
    clean: true,
    evidence: [],
  })),
  verify: jest.fn(
    (_payload: string, _sig: string) =>
      ({
        valid: true,
        reason: 'valid',
        fingerprint: 'host-fp-123',
        expiresAtMs: Date.now() + 86400000,
        daysLeft: 1,
        maxChats: 10,
      }) as any,
  ),
  antireplay: jest.fn<(statePath: string, now: number) => { ok: boolean }>(() => ({ ok: true })),
};

// ts-jest 以 CJS 转译，源码经 nodeRequire 加载 native 包；jest.mock 的工厂
// 注册进 jest 模块表后同样能被 nodeRequire 解析到（unstable_mockModule 只拦 ESM）。
jest.mock('@cs-bot/license-native', () => mockNative);

const makeLicense = (payload = '{"a":1}'): string =>
  `${Buffer.from(payload).toString('base64')}.c2ln`;

describe('NativeLicenseVerifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNative.fingerprint.mockReturnValue('host-fp-123');
    mockNative.selfcheck.mockReturnValue({ clean: true, evidence: [] });
    mockNative.verify.mockReturnValue({
      valid: true,
      reason: 'valid',
      fingerprint: 'host-fp-123',
      expiresAtMs: Date.now() + 86400000,
      daysLeft: 1,
      maxChats: 10,
    } as any);
    mockNative.antireplay.mockReturnValue({ ok: true });
  });

  it('构造期捕获 expectedFingerprint，fingerprint()/getFingerprint() 同源', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    expect(mockNative.fingerprint).toHaveBeenCalledTimes(1);
    expect(verifier.fingerprint()).toBe('host-fp-123');
    expect(verifier.getFingerprint()).toBe('host-fp-123');
  });

  it('构造期 fingerprint 抛异常 → expectedFingerprint=null，绑定跳过', async () => {
    mockNative.fingerprint.mockImplementation(() => {
      throw new Error('no-darwin-support');
    });
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    expect(verifier.fingerprint()).toBeNull();
    // expectedFingerprint=null 时即使 license fingerprint 不同也跳过绑定
    mockNative.verify.mockReturnValue({
      valid: true,
      reason: 'valid',
      fingerprint: 'other-fp',
      expiresAtMs: Date.now() + 86400000,
      daysLeft: 1,
      maxChats: 10,
    } as any);
    const result = verifier.verify(makeLicense(), null);
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('valid');
  });

  it('selfcheck 透传 native 结果', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.selfcheck.mockReturnValue({ clean: false, evidence: ['debugger-detected'] });
    const verifier = new NativeLicenseVerifier();
    const result = verifier.selfcheck();
    expect(result?.clean).toBe(false);
    expect(result?.evidence).toContain('debugger-detected');
  });

  it('selfcheck 抛异常 → null', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.selfcheck.mockImplementation(() => {
      throw new Error('crash');
    });
    const verifier = new NativeLicenseVerifier();
    expect(verifier.selfcheck()).toBeNull();
  });

  it('verify: 无点号 → bad-format', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    expect(verifier.verify('nodot', null).reason).toBe('bad-format');
  });

  it('verify: 点号在开头/结尾 → bad-format', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    expect(verifier.verify('.abc', null).reason).toBe('bad-format');
    expect(verifier.verify('abc.', null).reason).toBe('bad-format');
  });

  it('verify: payload base64 解码后传给 native（native 收到 JSON 明文）', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    verifier.verify(makeLicense('{"k":"v"}'), null);
    expect(mockNative.verify).toHaveBeenCalledWith('{"k":"v"}', 'c2ln');
  });

  it('verify: native 抛异常 → native-error', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.verify.mockImplementation(() => {
      throw new Error('native-crash');
    });
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), null);
    expect(result.reason).toBe('native-error');
    expect(result.valid).toBe(false);
  });

  it('verify: native 返回 !valid → 原样透传，不走绑定/反回放', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.verify.mockReturnValue({
      valid: false,
      reason: 'bad-signature',
      fingerprint: '',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    } as any);
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), '/tmp/state.json');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad-signature');
    expect(mockNative.antireplay).not.toHaveBeenCalled();
  });

  it('verify: fingerprint 不一致 → fingerprint-mismatch', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.verify.mockReturnValue({
      valid: true,
      reason: 'valid',
      fingerprint: 'other-fp',
      expiresAtMs: Date.now() + 86400000,
      daysLeft: 1,
      maxChats: 10,
    } as any);
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), null);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('fingerprint-mismatch');
  });

  it('verify: license fingerprint 为空串 → 跳过绑定', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.verify.mockReturnValue({
      valid: true,
      reason: 'valid',
      fingerprint: '',
      expiresAtMs: Date.now() + 86400000,
      daysLeft: 1,
      maxChats: 10,
    } as any);
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), null);
    expect(result.valid).toBe(true);
  });

  it('verify: antireplay 抛异常 → antireplay-failure', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.antireplay.mockImplementation(() => {
      throw new Error('antireplay-crash');
    });
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), '/tmp/state.json');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('antireplay-failure');
  });

  it('verify: antireplay ok=false → antireplay-failure（时间回拨）', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    mockNative.antireplay.mockReturnValue({ ok: false });
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), '/tmp/state.json');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('antireplay-failure');
  });

  it('verify: 全链路通过（含 antireplay）→ valid', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), '/tmp/state.json');
    expect(result.valid).toBe(true);
    expect(result.reason).toBe('valid');
    expect(mockNative.antireplay).toHaveBeenCalledWith('/tmp/state.json', expect.any(Number));
  });

  it('verify: statePath=null → 跳过反回放', async () => {
    const { NativeLicenseVerifier } = await import('../src/license/native-license.verifier.js');
    const verifier = new NativeLicenseVerifier();
    const result = verifier.verify(makeLicense(), null);
    expect(result.valid).toBe(true);
    expect(mockNative.antireplay).not.toHaveBeenCalled();
  });
});
