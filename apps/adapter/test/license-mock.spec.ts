/**
 * MockLicenseVerifier 单元测试
 *
 * 策略：真实写 license 文件到 tmpdir + 设置 LICENSE_FILE 指向该文件，避免使用 fs mock
 * （fs mock 会污染 pino 等模块对 fs.write 的依赖）。
 */
import { setConfig } from './__setup__/test-helpers.js';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const payload64 = (obj: object) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

let licenseFile: string;

beforeAll(() => {
  licenseFile = join(tmpdir(), `csbot-test-license-${Date.now()}.lic`);
});

afterAll(() => {
  if (existsSync(licenseFile)) {
    try { unlinkSync(licenseFile); } catch { /* */ }
  }
});

describe('MockLicenseVerifier', () => {
  it('license 文件不存在：valid=true, mock=true', async () => {
    setConfig({ LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
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
    writeFileSync(licenseFile, `${payload}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
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
    writeFileSync(licenseFile, 'garbage-content', 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('malformed');
    expect(state.mock).toBe(true);
  });

  it('payload JSON 损坏：valid=true, reason=malformed', async () => {
    const bad = Buffer.from('{invalid-json', 'utf8').toString('base64');
    writeFileSync(licenseFile, `${bad}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier({} as any);
    const state = await v.verify();
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('malformed');
  });
});