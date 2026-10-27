/**
 * 控制面 → 租户实例同步客户端（HTTP，TLS 可配，重试）
 */
import axios from 'axios';
import https from 'node:https';

export interface SyncTarget {
  id: string;
  host: string | null;
  port: number | null;
}

export interface SyncPayload {
  tenantId: string;
  name: string;
  status: string;
  expiredAt: string | null;
  quota: {
    maxChats: number;
    maxStorageMb: number;
    maxApiCalls: number;
    maxUsers: number;
    maxLlmTokensPerMonth: number;
  };
}

export class HttpTenantSyncClient {
  constructor(
    private readonly opts: {
      scheme: string;
      verifyTls: boolean;
      timeoutMs: number;
      maxAttempts?: number;
    },
  ) {}

  async sync(target: SyncTarget, token: string, payload: SyncPayload): Promise<void> {
    if (!target.host || !target.port) throw new Error('tenant host/port missing');
    const url = `${this.opts.scheme}://${target.host}:${target.port}/internal/tenant/sync`;
    const httpsAgent =
      this.opts.scheme === 'https'
        ? new https.Agent({ rejectUnauthorized: this.opts.verifyTls })
        : undefined;
    const max = this.opts.maxAttempts ?? 3;
    let lastErr: Error | null = null;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        await axios.post(url, payload, {
          timeout: this.opts.timeoutMs,
          httpsAgent,
          headers: { Authorization: `Bearer ${token}` },
        });
        return;
      } catch (err) {
        lastErr = err as Error;
        if (attempt < max) {
          await new Promise((r) => setTimeout(r, Math.min(300 * 2 ** (attempt - 1), 5000)));
        }
      }
    }
    throw lastErr ?? new Error('tenant sync failed');
  }
}
