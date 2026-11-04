/**
 * SaaS 通配证书 ACME DNS-01 续期编排（PLATFORM_CERT_CMD → PLATFORM_WILDCARD_CERT_DIR）
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigService } from '../config/config.service.js';
import { OpsAlertService } from '../common/ops-alert.service.js';
import { WildcardCertificateProvider } from './certificate-provider.js';

const execFileP = promisify(execFile);

export type WildcardRenewRunner = (cmd: string, wildDomain: string, certDir: string) => Promise<void>;

export interface WildcardTlsStatus {
  tlsMode: string;
  baseDomain: string;
  certDir: string;
  cmdConfigured: boolean;
  materialPresent: boolean;
  notAfter: string | null;
  expired: boolean;
  daysUntilExpiry: number | null;
  renewInFlight: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrCode: string | null;
}

const CERT_CANDIDATES = [
  ['fullchain.pem', 'privkey.pem'],
  ['wildcard.crt', 'wildcard.key'],
] as const;

const RENEW_LOCK_TTL_MS = 600_000;

let renewInFlight = false;
let renewLockUntil = 0;

export class WildcardTlsService {
  private lastAttemptAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private lastError: string | null = null;
  private lastErrCode: string | null = null;

  constructor(
    private readonly ops: OpsAlertService = new OpsAlertService(),
    private readonly runCmd: WildcardRenewRunner = defaultRenewRunner,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async renew(): Promise<{ ok: true; notAfter: string | null }> {
    const { wildDomain, certDir, cmd } = this.requireRenewConfig();
    if (!this.acquireLock()) {
      throw new ConflictException({
        errCode: 'TLS_WILDCARD_RENEW_IN_PROGRESS',
        detail: 'wildcard certificate renew is already running',
      });
    }
    this.lastAttemptAt = new Date(this.now()).toISOString();
    this.lastError = null;
    this.lastErrCode = null;
    try {
      await this.runCmd(cmd, wildDomain, certDir);
      const meta = await this.readCertMeta(certDir);
      if (!meta.present) {
        throw new Error('renew command succeeded but cert material is still missing');
      }
      this.lastSuccessAt = new Date(this.now()).toISOString();
      return { ok: true, notAfter: meta.notAfter };
    } catch (err) {
      const detail = (err as Error).message || 'wildcard renew failed';
      this.lastError = detail;
      this.lastErrCode = 'TLS_ACME_DNS01_FAILED';
      await this.ops.alert(
        'wildcard-tls-renew-failed',
        `通配 TLS 续期失败（${wildDomain}）：${detail.slice(0, 400)}`,
      );
      throw new BadRequestException({ errCode: 'TLS_ACME_DNS01_FAILED', detail });
    } finally {
      this.releaseLock();
    }
  }

  async status(): Promise<WildcardTlsStatus> {
    const cfg = ConfigService.instance;
    const tlsMode = cfg.PLATFORM_TLS_MODE ?? 'dedicated';
    const baseDomain = cfg.PLATFORM_WILDCARD_BASE_DOMAIN ?? '';
    const certDir = cfg.PLATFORM_WILDCARD_CERT_DIR || cfg.PLATFORM_CERT_DIR;
    const cmdConfigured = Boolean(cfg.PLATFORM_CERT_CMD?.trim());
    const meta = tlsMode === 'wildcard' ? await this.readCertMeta(certDir) : { present: false, notAfter: null, expired: false, daysUntilExpiry: null };

    if (tlsMode === 'wildcard' && meta.present && meta.expired) {
      await this.ops.alert(
        'wildcard-tls-expired',
        `通配 TLS 证书已过期（${baseDomain || certDir}），请执行 renew 或检查 DNS-01 凭据`,
      );
    }

    return {
      tlsMode,
      baseDomain,
      certDir,
      cmdConfigured,
      materialPresent: meta.present,
      notAfter: meta.notAfter,
      expired: meta.expired,
      daysUntilExpiry: meta.daysUntilExpiry,
      renewInFlight,
      lastAttemptAt: this.lastAttemptAt,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      lastErrCode: this.lastErrCode,
    };
  }

  private requireRenewConfig(): { wildDomain: string; certDir: string; cmd: string } {
    const cfg = ConfigService.instance;
    if (cfg.PLATFORM_TLS_MODE !== 'wildcard') {
      throw new BadRequestException({
        errCode: 'TLS_WILDCARD_MODE_REQUIRED',
        detail: 'PLATFORM_TLS_MODE must be wildcard to renew shared certificate',
      });
    }
    const base = (cfg.PLATFORM_WILDCARD_BASE_DOMAIN ?? '').trim();
    if (!base) {
      throw new BadRequestException({
        errCode: 'TLS_WILDCARD_BASE_DOMAIN_REQUIRED',
        detail: 'PLATFORM_WILDCARD_BASE_DOMAIN is required',
      });
    }
    const cmd = (cfg.PLATFORM_CERT_CMD ?? '').trim();
    if (!cmd) {
      throw new BadRequestException({
        errCode: 'TLS_WILDCARD_CMD_REQUIRED',
        detail: 'PLATFORM_CERT_CMD must run ACME DNS-01 and write shared wildcard material',
      });
    }
    const certDir = cfg.PLATFORM_WILDCARD_CERT_DIR || cfg.PLATFORM_CERT_DIR;
    const wildDomain = base.startsWith('*.') ? base : `*.${base.replace(/^\*\./, '')}`;
    return { wildDomain, certDir, cmd };
  }

  private acquireLock(): boolean {
    const t = this.now();
    if (renewInFlight && t < renewLockUntil) return false;
    renewInFlight = true;
    renewLockUntil = t + RENEW_LOCK_TTL_MS;
    return true;
  }

  private releaseLock(): void {
    renewInFlight = false;
    renewLockUntil = 0;
  }

  private async readCertMeta(certDir: string): Promise<{
    present: boolean;
    notAfter: string | null;
    expired: boolean;
    daysUntilExpiry: number | null;
  }> {
    for (const [certName] of CERT_CANDIDATES) {
      try {
        const pem = await readFile(`${certDir}/${certName}`, 'utf8');
        const x = new X509Certificate(pem);
        const notAfterMs = Date.parse(x.validTo);
        const daysUntilExpiry = Number.isFinite(notAfterMs)
          ? Math.floor((notAfterMs - this.now()) / 86_400_000)
          : null;
        const expired = daysUntilExpiry !== null ? daysUntilExpiry < 0 : false;
        return { present: true, notAfter: x.validTo, expired, daysUntilExpiry };
      } catch {
        /* try next candidate */
      }
    }
    return { present: false, notAfter: null, expired: false, daysUntilExpiry: null };
  }
}

async function defaultRenewRunner(cmd: string, wildDomain: string, certDir: string): Promise<void> {
  await execFileP(cmd, [wildDomain, certDir], { timeout: 600_000 });
  // 续期成功后应能走 WildcardCertificateProvider 同一套文件名
  const base = wildDomain.replace(/^\*\./, '');
  await new WildcardCertificateProvider(certDir, base).issue(`check.${base}`);
}

/** 测试：重置进程内 renew 锁 */
export function resetWildcardTlsRenewLockForTests(): void {
  renewInFlight = false;
  renewLockUntil = 0;
}
