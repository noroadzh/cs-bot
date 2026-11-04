/**
 * 控制面 → 租户实例：指纹回采与 license 热加载
 */
import axios from 'axios';
import https from 'node:https';

export interface InstanceTarget {
  host: string;
  port: number;
}

export interface TenantInstanceClient {
  fetchFingerprint(target: InstanceTarget, token: string): Promise<string>;
  reloadLicense(
    target: InstanceTarget,
    adminUser: string,
    adminPassword: string,
  ): Promise<void>;
}

export class HttpTenantInstanceClient implements TenantInstanceClient {
  constructor(
    private readonly opts: {
      scheme: string;
      verifyTls: boolean;
      timeoutMs: number;
      maxAttempts?: number;
    },
  ) {}

  private agent() {
    return this.opts.scheme === 'https'
      ? new https.Agent({ rejectUnauthorized: this.opts.verifyTls })
      : undefined;
  }

  async fetchFingerprint(target: InstanceTarget, token: string): Promise<string> {
    const url = `${this.opts.scheme}://${target.host}:${target.port}/internal/instance/fingerprint`;
    const max = this.opts.maxAttempts ?? 3;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const resp = await axios.get<{ fingerprint?: string }>(url, {
          timeout: this.opts.timeoutMs,
          httpsAgent: this.agent(),
          headers: { Authorization: `Bearer ${token}` },
        });
        const fp = String(resp.data?.fingerprint ?? '').trim().toLowerCase();
        if (!/^[a-f0-9]{64}$/.test(fp)) {
          throw new Error('invalid fingerprint payload');
        }
        return fp;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < max) {
          await new Promise((r) => setTimeout(r, Math.min(300 * 2 ** (attempt - 1), 5000)));
        }
      }
    }
    throw lastErr ?? new Error('fingerprint fetch failed');
  }

  async reloadLicense(
    target: InstanceTarget,
    adminUser: string,
    adminPassword: string,
  ): Promise<void> {
    const url = `${this.opts.scheme}://${target.host}:${target.port}/admin/license/reload`;
    const auth = Buffer.from(`${adminUser}:${adminPassword}`, 'utf8').toString('base64');
    await axios.post(
      url,
      {},
      {
        timeout: this.opts.timeoutMs,
        httpsAgent: this.agent(),
        headers: { Authorization: `Basic ${auth}` },
      },
    );
  }
}
