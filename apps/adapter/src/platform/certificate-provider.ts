/**
 * CertificateProvider — 租户 TLS 证书签发接口（概设 §5 M11 开通编排）
 *
 * 默认实现可替换：ACME/DNS、预置证书文件、测试 fake。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
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
  issue(tenant: {
    id: string;
    host: string | null;
    fingerprint?: string;
    expiresAtMs?: number;
    maxChats?: number;
  }): Promise<void>;
}

export class NoopLicenseIssuer implements LicenseIssuer {
  async issue(_tenant: { id: string; host: string | null }): Promise<void> {
    /* no-op */
  }
}

/** 生产环境不得用仓库里的测试私钥签发 */
export function assertProductionSigningKey(keyPath: string): void {
  if (process.env.NODE_ENV === 'production' && keyPath.includes('/test_keys/')) {
    throw new Error('refusing test signing key in production');
  }
}

/**
 * 生产：调用交付侧签发 CLI。
 * 参数只有 --key --fingerprint --expires --max-chats（CLI 不接受 issue / --tenant / --host）。
 * LICENSE_SIGN_CMD 非空时改为：stdin 写入 payload JSON，stdout 取 base64 签名。
 */
export class ShellLicenseIssuer implements LicenseIssuer {
  constructor(
    private readonly bin: string,
    private readonly keyPath = '',
    private readonly outDir = '',
    private readonly timeoutMs = 60_000,
    private readonly signCmd = '',
  ) {}

  async issue(tenant: {
    id: string;
    host: string | null;
    fingerprint?: string;
    expiresAtMs?: number;
    maxChats?: number;
  }): Promise<void> {
    if (this.keyPath !== '') assertProductionSigningKey(this.keyPath);
    if (!tenant.fingerprint) throw new Error('fingerprint is required');
    const expiresAtMs = tenant.expiresAtMs ?? Date.now() + 365 * 24 * 60 * 60 * 1000;
    const maxChats = tenant.maxChats ?? 100;
    const payload = {
      payload: 'CSBOT',
      fingerprint: tenant.fingerprint,
      expires_at_ms: expiresAtMs,
      max_chats: maxChats,
      ts: Date.now(),
    };
    const payloadJson = JSON.stringify(payload);

    if (this.signCmd !== '') {
      const sig = await signWithCommand(this.signCmd, payloadJson, this.timeoutMs);
      await this.persist(tenant.id, `${Buffer.from(payloadJson, 'utf8').toString('base64')}.${sig}`);
      return;
    }

    if (this.keyPath === '') throw new Error('LICENSE_ISSUER_KEY is required for shell issuer');
    const args = [
      '--key', this.keyPath,
      '--fingerprint', tenant.fingerprint,
      '--expires', String(expiresAtMs),
      '--max-chats', String(maxChats),
    ];
    const res = /\.(mjs|c?js)$/.test(this.bin)
      ? await execFileP(process.execPath, [this.bin, ...args], { timeout: this.timeoutMs })
      : await execFileP(this.bin, args, { timeout: this.timeoutMs });
    const license = typeof res.stdout === 'string' ? res.stdout.trim() : '';
    if (license !== '') await this.persist(tenant.id, license);
  }

  private async persist(tenantId: string, license: string): Promise<void> {
    if (this.outDir === '') return;
    const dir = `${this.outDir}/${tenantId}/license`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/license.lic`, license, { mode: 0o600 });
  }
}

function signWithCommand(cmd: string, payloadJson: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('LICENSE_SIGN_CMD timeout'));
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const sig = stdout.trim();
      if (code === 0 && sig !== '') resolve(sig);
      else reject(new Error(`LICENSE_SIGN_CMD exit ${code}: ${stderr.slice(-500)}`));
    });
    child.stdin?.end(payloadJson);
  });
}
