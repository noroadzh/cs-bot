/**
 * MockLicenseVerifier 单元测试
 * 覆盖：无文件 valid+mock / 有合法文件 valid+!mock / 格式错误 malformed / 文件损坏 invalid
 */
import { setConfig } from './__setup__/test-helpers.js';

beforeAll(() => setConfig());

const payload64 = (obj: object) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

describe('MockLicenseVerifier', () => {
  it('license 文件不存在：valid=true, mock=true', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(false),
    }));
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.mock).toBe(true);
    expect(state.reason).toBe('mock');
  });

  it('合法格式 license：valid=true, reason=valid', async () => {
    const payload = payload64({
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      maxChats: 100,
      fingerprint: 'fp-001',
    });
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(`${payload}.c2ln`),
      existsSync: jest.fn().mockReturnValue(true),
    }));
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('valid');
    expect(state.maxChats).toBe(100);
    expect(state.fingerprint).toBe('fp-001');
    expect(state.mock).toBe(true);
  });

  it('格式错误：valid=true, reason=malformed（mock 模式不阻断）', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue('garbage-content'),
      existsSync: jest.fn().mockReturnValue(true),
    }));
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('malformed');
    expect(state.mock).toBe(true);
  });

  it('payload JSON 损坏：valid=true, reason=malformed', async () => {
    // base64 of invalid JSON
    const bad = Buffer.from('{invalid-json', 'utf8').toString('base64');
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(`${bad}.c2ln`),
      existsSync: jest.fn().mockReturnValue(true),
    }));
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('malformed');
  });
});
