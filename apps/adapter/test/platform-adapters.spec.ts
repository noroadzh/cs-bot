/**
 * M11 生产适配器：证书/签发/升级/健康探测 + 生产禁用桩
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CommandCertificateProvider, FileCertificateProvider, ShellLicenseIssuer } from '../src/platform/certificate-provider.js';
import { ShellUpgradeDeps } from '../src/platform/upgrade-runner.js';
import { HttpHealthSource } from '../src/platform/platform-monitor.js';
import { TenantService } from '../src/platform/tenant.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

jest.setTimeout(60_000);

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csbot-adapters-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(join(dir, 'bin.sh'), { force: true });
});

afterEach(() => {
  resetConfig();
  delete process.env.NODE_ENV;
});

describe('CommandCertificateProvider', () => {
  it('调用外部命令并按域名读取证书', async () => {
    const script = join(dir, 'cert.sh');
    await writeFile(script, `#!/bin/sh\nmkdir -p "$2"\necho CERT-$1 > "$2/$1.crt"\necho KEY-$1 > "$2/$1.key"\n`);
    await chmod(script, 0o755);
    const p = new CommandCertificateProvider(script, join(dir, 'certs'));
    await expect(p.issue('t.example.com')).resolves.toEqual({
      cert: 'CERT-t.example.com\n',
      key: 'KEY-t.example.com\n',
    });
  }, 60_000);
});

describe('FileCertificateProvider', () => {
  it('读取 <domain>.crt/<domain>.key', async () => {
    await writeFile(join(dir, 'a.example.com.crt'), 'CERT-A');
    await writeFile(join(dir, 'a.example.com.key'), 'KEY-A');
    const p = new FileCertificateProvider(dir);
    await expect(p.issue('a.example.com')).resolves.toEqual({ cert: 'CERT-A', key: 'KEY-A' });
  });
});

describe('ShellLicenseIssuer', () => {
  it('调用签发 CLI 并传递 tenant/host', async () => {
    const out = join(dir, 'issued.txt');
    await writeFile(join(dir, 'bin.sh'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${out}\n`);
    await chmod(join(dir, 'bin.sh'), 0o755);
    const key = join(dir, 'issuer.pem');
    await writeFile(key, 'KEY');
    const issuer = new ShellLicenseIssuer(join(dir, 'bin.sh'), key);
    await issuer.issue({
      id: 'T-1',
      host: 't1.example.com',
      fingerprint: 'fp-1',
      expiresAtMs: 1_700_000_000_000,
      maxChats: 15,
    });
    const args = (await readFile(out, 'utf8')).trim().split('\n');
    expect(args).toEqual([
      '--key', key,
      '--fingerprint', 'fp-1',
      '--expires', '1700000000000',
      '--max-chats', '15',
    ]);
  }, 60_000);

  it('缺少 fingerprint 时不调用 CLI', async () => {
    const issuer = new ShellLicenseIssuer(join(dir, 'missing'), join(dir, 'nope.pem'));
    await expect(issuer.issue({ id: 'T-1', host: 't1.example.com' })).rejects.toThrow(/fingerprint/);
  });

  it('LICENSE_SIGN_CMD 读取 stdin 上的 payload，stdout 作为签名', async () => {
    const script = join(dir, 'sign.sh');
    await writeFile(script, '#!/bin/sh\ncat >/dev/null\nprintf \'SIG64\\n\'\n');
    await chmod(script, 0o755);
    const issuer = new ShellLicenseIssuer('unused', '', dir, 5_000, script);
    await issuer.issue({ id: 'T-2', host: 'h', fingerprint: 'fp-sign', expiresAtMs: 10, maxChats: 1 });
    const saved = await readFile(join(dir, 'T-2', 'license', 'license.lic'), 'utf8');
    expect(saved.endsWith('.SIG64')).toBe(true);
    const payload = JSON.parse(Buffer.from(saved.slice(0, saved.lastIndexOf('.')), 'base64').toString('utf8'));
    expect(payload).toMatchObject({ payload: 'CSBOT', fingerprint: 'fp-sign', max_chats: 1 });
  });

  it('production 拒绝 test_keys 路径', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const issuer = new ShellLicenseIssuer('bin', '/opt/test_keys/k.pem');
      await expect(issuer.issue({
        id: 'T',
        host: 'h',
        fingerprint: 'fp',
        expiresAtMs: 1,
        maxChats: 1,
      })).rejects.toThrow(/test signing key/);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});

describe('ShellUpgradeDeps', () => {
  it('snapshot/swap/rollback 调用脚本；health 失败返回 false', async () => {
    const log = join(dir, 'upgrade.log');
    const script = join(dir, 'upgrade.sh');
    await writeFile(
      script,
      `#!/bin/sh\necho "$@" >> ${log}\nif [ "$1" = health ] && [ "$2" = bad ]; then exit 1; fi\nexit 0\n`,
    );
    await chmod(script, 0o755);
    const deps = new ShellUpgradeDeps(script, 5000, 0);
    await deps.snapshot('T-1');
    await deps.swapImage('T-1', 'v2');
    await deps.rollback('T-1');
    await expect(deps.health('ok')).resolves.toBe(true);
    await expect(deps.health('bad')).resolves.toBe(false);
    const lines = (await readFile(log, 'utf8')).trim().split('\n');
    expect(lines).toContain('snapshot T-1');
    expect(lines).toContain('swap T-1 v2');
    expect(lines).toContain('rollback T-1');
  });
});

describe('HttpHealthSource', () => {
  it('DB 不可用/无 host → unhealthy（不抛出）', async () => {
    const src = new HttpHealthSource('postgresql://x:x@127.0.0.1:1/none', { scheme: 'https', verifyTls: false, timeoutMs: 200 });
    await expect(src.probe('T-1')).resolves.toMatchObject({ tenantId: 'T-1', healthy: false });
    await src.close();
  });
});

describe('生产禁用桩', () => {
  it('PLATFORM_ENABLED + production + fake/noop → 启动拒绝', () => {
    setConfig({
      PLATFORM_ENABLED: true,
      PLATFORM_TLS_PROVIDER: 'fake',
      LICENSE_ISSUER: 'noop',
      PLATFORM_CERT_DIR: dir,
      LICENSE_ISSUER_BIN: join(dir, 'missing'),
    });
    process.env.NODE_ENV = 'production';
    expect(() => new TenantService({} as any, {} as any, {} as any, {} as any)).toThrow(
      /fake is not allowed|noop is not allowed/,
    );
  });

  it('file + shell 在 production 可构造', () => {
    setConfig({
      PLATFORM_ENABLED: true,
      PLATFORM_TLS_PROVIDER: 'file',
      LICENSE_ISSUER: 'shell',
      PLATFORM_CERT_DIR: dir,
      LICENSE_ISSUER_BIN: join(dir, 'bin.sh'),
    });
    process.env.NODE_ENV = 'production';
    expect(() => new TenantService({} as any, {} as any, {} as any, {} as any)).not.toThrow();
  });
});
