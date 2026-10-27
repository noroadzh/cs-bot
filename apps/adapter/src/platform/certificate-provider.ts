/**
 * CertificateProvider — 租户 TLS 证书签发接口（概设 §5 M11 开通编排）
 *
 * 默认实现可替换：ACME/DNS、预置证书文件、测试 fake。
 */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface IssuedCert {
  cert: string;
  key: string;
}

export interface CertificateProvider {
  issue(domain: string): Promise<IssuedCert>;
}

/** 测试/开发：返回假证书 */
export class FakeCertificateProvider implements CertificateProvider {
  readonly issued: string[] = [];
  constructor(private readonly failDomains: Set<string> = new Set()) {}

  async issue(domain: string): Promise<IssuedCert> {
    if (this.failDomains.has(domain)) throw new Error(`certificate issuance failed: ${domain}`);
    this.issued.push(domain);
    return { cert: `FAKE-CERT:${domain}`, key: `FAKE-KEY:${domain}` };
  }
}

/** 预置证书文件：<dir>/<domain>.crt + <domain>.key */
export class FileCertificateProvider implements CertificateProvider {
  constructor(private readonly dir: string) {}

  async issue(domain: string): Promise<IssuedCert> {
    const cert = await readFile(`${this.dir}/${domain}.crt`, 'utf8');
    const key = await readFile(`${this.dir}/${domain}.key`, 'utf8');
    return { cert, key };
  }
}

/** 通过外部命令签发（certbot/acme.sh 脚本）：<cmd> <domain> <dir>，产物为 <dir>/<domain>.crt/.key */
export class CommandCertificateProvider implements CertificateProvider {
  constructor(private readonly cmd: string, private readonly dir: string) {}

  async issue(domain: string): Promise<IssuedCert> {
    await execFileP(this.cmd, [domain, this.dir], { timeout: 120_000 });
    const cert = await readFile(`${this.dir}/${domain}.crt`, 'utf8');
    const key = await readFile(`${this.dir}/${domain}.key`, 'utf8');
    return { cert, key };
  }
}

/** 订阅期授权签发（调用 M9 签发，绑定实例指纹） */
export interface LicenseIssuer {
  issue(tenant: { id: string; host: string | null }): Promise<void>;
}

export class NoopLicenseIssuer implements LicenseIssuer {
  async issue(_tenant: { id: string; host: string | null }): Promise<void> {
    /* no-op */
  }
}

/** 生产：调用交付侧签发 CLI（默认 tools/license-issuer/license-issuer） */
export class ShellLicenseIssuer implements LicenseIssuer {
  constructor(private readonly bin: string, private readonly timeoutMs = 60_000) {}

  async issue(tenant: { id: string; host: string | null }): Promise<void> {
    await execFileP(
      this.bin,
      ['issue', '--tenant', tenant.id, '--host', tenant.host ?? ''],
      { timeout: this.timeoutMs },
    );
  }
}
