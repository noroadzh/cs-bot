/**
 * MockLicenseVerifier 单元测试
 *
 * 对应 B.4 强校验路径：
 *  - license 文件缺失 → valid=false, reason=mock-no-license
 *  - 格式错误（分段数≠2 / payload JSON 损坏）→ valid=false, reason=malformed
 *  - 过期 → valid=false, reason=expired
 *  - 有效 → valid=true, reason=valid
 *  - 格式 OK 但 payload.expiresAt 缺失 → valid=false, reason=malformed
 *  - mock 模式不调 fingerprint 也不验签
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const payload64 = (obj: object) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');

/**
 * MockLicenseVerifier.verify() 只解析传入的字符串，不读 LICENSE_FILE。
 * 生产路径是 LicenseService 先读文件再传给 verify()；这里补上同一层读取。
 */
const readLicense = (path: string): string => readFileSync(path, 'utf8');

let licenseFile: string;

beforeAll(() => {
  licenseFile = join(tmpdir(), `csbot-test-license-${Date.now()}.lic`);
});

afterAll(() => {
  if (existsSync(licenseFile)) {
    try { unlinkSync(licenseFile); } catch { /* */ }
  }
});

beforeEach(() => {
  resetConfig();
});

describe('MockLicenseVerifier', () => {
  it('B.4.a license 文件不存在：valid=false, reason=mock-no-license', async () => {
    setConfig({ LICENSE_FILE: '/tmp/csbot-nonexistent-license.lic' });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify();
    expect(state.valid).toBe(false);
    expect(state.mock).toBe(true);
    expect(state.reason).toBe('mock-no-license');
  });

  it('B.4.b 合法格式 + 未过期：valid=true, reason=valid', async () => {
    const payload = payload64({
      expiresAtMs: Date.now() + 365 * 86400000,
      maxChats: 100,
      fingerprint: 'fp-001',
    });
    writeFileSync(licenseFile, `${payload}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('valid');
    expect(state.maxChats).toBe(100);
    expect(state.fingerprint).toBe('fp-001');
    expect(state.mock).toBe(true);
    expect(state.daysLeft).toBeGreaterThan(360);
  });

  it('B.4.c 格式错误（无 . 分隔）：valid=false, reason=malformed', async () => {
    writeFileSync(licenseFile, 'garbage-content', 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('malformed');
    expect(state.mock).toBe(true);
  });

  it('B.4.d payload JSON 损坏：valid=false, reason=malformed', async () => {
    const bad = Buffer.from('{invalid-json', 'utf8').toString('base64');
    writeFileSync(licenseFile, `${bad}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('malformed');
  });

  it('B.4.e 过期 license：valid=false, reason=expired', async () => {
    const payload = payload64({
      expiresAtMs: Date.now() - 86400000,
      maxChats: 100,
      fingerprint: 'fp-002',
    });
    writeFileSync(licenseFile, `${payload}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('expired');
    expect(state.daysLeft).toBe(-1);
  });

  it('B.4.f 缺失 expiresAtMs 字段：valid=false, reason=malformed', async () => {
    const payload = payload64({ maxChats: 100, fingerprint: 'fp-x' });
    writeFileSync(licenseFile, `${payload}.c2ln`, 'utf8');
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(false);
    expect(state.reason).toBe('malformed');
  });

  it('B.4.g mock 模式不调 fingerprint 也不验签（只看格式）', async () => {
    const payload = payload64({
      expiresAtMs: Date.now() + 86400000,
      maxChats: 50,
      fingerprint: 'any-fp-ok',
    });
    writeFileSync(licenseFile, `${payload}.aGVsbG8=`, 'utf8'); // 任意 sig
    setConfig({ LICENSE_FILE: licenseFile });
    const { MockLicenseVerifier } = await import('../src/license/mock-license.verifier.js');
    const v = new MockLicenseVerifier();
    const state = v.verify(readLicense(licenseFile));
    expect(state.valid).toBe(true);
    expect(state.reason).toBe('valid');
  });
});