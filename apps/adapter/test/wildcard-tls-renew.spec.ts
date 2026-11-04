import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import {
  WildcardTlsService,
  resetWildcardTlsRenewLockForTests,
} from '../src/platform/wildcard-tls.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('WildcardTlsService renew', () => {
  beforeEach(() => {
    resetWildcardTlsRenewLockForTests();
    setConfig({
      PLATFORM_TLS_MODE: 'wildcard',
      PLATFORM_WILDCARD_BASE_DOMAIN: 'saas.example',
      PLATFORM_WILDCARD_CERT_DIR: '',
      PLATFORM_CERT_DIR: 'data/certs',
      PLATFORM_CERT_CMD: '/bin/renew-wildcard',
      OPS_WEBHOOK_URL: '',
    });
  });
  afterEach(() => resetConfig());

  it('renew 失败返回 TLS_ACME_DNS01_FAILED 并触发 ops 告警', async () => {
    const alerts: string[] = [];
    const svc = new WildcardTlsService(
      {
        alert: async (_key, content) => {
          alerts.push(content);
          return true;
        },
        isCooling: () => false,
      } as any,
      async () => {
        throw new Error('dns-01 challenge failed');
      },
    );

    try {
      await svc.renew();
      throw new Error('expected renew to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        errCode: 'TLS_ACME_DNS01_FAILED',
      });
    }
    expect(alerts.some((a) => a.includes('续期失败'))).toBe(true);
    const st = await svc.status();
    expect(st.lastErrCode).toBe('TLS_ACME_DNS01_FAILED');
    expect(st.lastError).toContain('dns-01');
  });

  it('非 wildcard 模式拒绝 renew', async () => {
    setConfig({ PLATFORM_TLS_MODE: 'dedicated' });
    const svc = new WildcardTlsService();
    await expect(svc.renew()).rejects.toBeInstanceOf(BadRequestException);
  });

});
