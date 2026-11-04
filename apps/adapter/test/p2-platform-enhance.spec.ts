import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ModelRouterService } from '../src/qa/model-router.service.js';
import { FinetuneJobService } from '../src/platform/finetune-job.service.js';
import { MetricsService } from '../src/health/metrics.service.js';
import { WildcardCertificateProvider, FakeCertificateProvider } from '../src/platform/certificate-provider.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('P2 platform enhance', () => {
  beforeEach(() =>
    setConfig({
      MODEL_CATALOG_JSON: '[]',
      MODEL_PROBE_FAIL_THRESHOLD: 2,
      MODEL_PROBE_INTERVAL_MS: 0,
      METRICS_ENABLED: false,
      DATABASE_URL: 'postgres://x',
    }),
  );
  afterEach(() => resetConfig());

  it('不健康端点不被 pick', () => {
    const router = new ModelRouterService({} as any);
    router.register({ id: 'a', name: 'a', baseUrl: 'http://a', latencyMs: 10 });
    router.register({ id: 'b', name: 'b', baseUrl: 'http://b', latencyMs: 20 });
    router.markProbeResult('a', false, 'down');
    router.markProbeResult('a', false, 'down');
    expect(router.list().find((e) => e.id === 'a')?.healthy).toBe(false);
    expect(router.pick('latency')?.id).toBe('b');
    expect(router.pickFallback('b')).toBeNull();
  });

  it('finetune complete 登记 catalog', async () => {
    const router = new ModelRouterService({} as any);
    const jobs = new FinetuneJobService(router, {
      query: jest.fn(async () => {
        throw new Error('no pg');
      }),
      end: jest.fn(async () => undefined),
    } as any);
    const created = await jobs.create({ name: 'lora-job' });
    const { endpoint } = await jobs.complete({
      id: created.id,
      artifactUri: 's3://art/1',
      baseUrl: 'http://lora',
    });
    expect(endpoint.kind).toBe('lora');
    expect(router.list().some((m) => m.id === created.id)).toBe(true);
  });

  it('metrics 关闭时 enabled=false；开启时含系列', () => {
    const usage = {
      getUsage: () => ({
        counters: {
          messagesReceived: 3,
          messagesAnswered: 2,
          messagesMissed: 1,
          llmFailures: 0,
        },
      }),
    };
    setConfig({ METRICS_ENABLED: false });
    const off = new MetricsService(usage as any);
    expect(off.enabled()).toBe(false);
    setConfig({ METRICS_ENABLED: true });
    const on = new MetricsService(usage as any);
    expect(on.enabled()).toBe(true);
    const body = on.render();
    expect(body).toContain('csbot_up 1');
    expect(body).toContain('csbot_messages_received_total 3');
  });

  it('wildcard 证书校验域名并读取共享材料', async () => {
    const dir = join(tmpdir(), `csbot-wild-${Date.now()}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'fullchain.pem'), 'CERT');
    await fs.writeFile(join(dir, 'privkey.pem'), 'KEY');
    const p = new WildcardCertificateProvider(dir, 'saas.example');
    await expect(p.issue('evil.com')).rejects.toThrow(/mismatch/);
    const issued = await p.issue('t1.saas.example');
    expect(issued.cert).toBe('CERT');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('wildcard + fake：域名必须落在 baseDomain', async () => {
    const base = 'saas.example';
    const provider = {
      async issue(domain: string) {
        const host = domain.toLowerCase();
        if (!(host === base || host.endsWith(`.${base}`))) {
          throw new Error(`wildcard SNI domain mismatch: ${domain} not under ${base}`);
        }
        return new FakeCertificateProvider().issue(domain);
      },
    };
    await expect(provider.issue('bad.com')).rejects.toThrow(/mismatch/);
    const ok = await provider.issue('a.saas.example');
    expect(ok.cert).toContain('a.saas.example');
  });
});
