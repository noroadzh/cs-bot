import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ArchiveService } from '../src/archive/archive.service.js';
import { OpsAlertService } from '../src/common/ops-alert.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('quality inspection', () => {
  beforeEach(() =>
    setConfig({
      QUALITY_SENSITIVE_HITS_THRESHOLD: 0,
      QUALITY_REFUSAL_RATE_THRESHOLD: 0.5,
      QUALITY_P95_LATENCY_MS_THRESHOLD: 8_000,
      OPS_ALERT_COOLDOWN_MS: 60_000,
      DATABASE_URL: 'postgres://x',
      TENANT_ID: 't1',
    }),
  );
  afterEach(() => resetConfig());

  it('持久化采样并返回 inspectionId；超阈告警带 cooldown', async () => {
    const sent: string[] = [];
    // OpsAlert 用 last=0 起算；now 须大于 cooldown，否则首次会被误判为冷却中
    const ops = new OpsAlertService({
      cooldownMs: 60_000,
      now: () => 100_000,
      send: async (c) => {
        sent.push(c);
        return true;
      },
    });
    const pool = {
      query: jest.fn(async () => {
        throw new Error('no pg');
      }),
      end: jest.fn(async () => undefined),
    };
    const svc = new ArchiveService({} as any, pool as any, ops);
    const first = await svc.runQualityChecks({
      sensitiveHits: 2,
      refusals: 6,
      total: 10,
      p95LatencyMs: 9_000,
      windowLabel: 'daily',
    });
    expect(first.inspectionId).toBeTruthy();
    expect(first.alerts.map((a) => a.rule).sort()).toEqual([
      'latency',
      'refusal_rate',
      'sensitive',
    ]);
    expect(sent.length).toBe(3);

    const second = await svc.runQualityChecks({
      sensitiveHits: 1,
      refusals: 0,
      total: 1,
      p95LatencyMs: 100,
      windowLabel: 'daily',
    });
    expect(second.alerts.some((a) => a.rule === 'sensitive')).toBe(true);
    // same rule+window still cooling → no extra send for sensitive
    expect(sent.filter((s) => s.includes('sensitive')).length).toBe(1);

    const list = await svc.listInspections({ limit: 10 });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0].alerts).toBeDefined();
  });

  it('未超阈不告警', async () => {
    const sent: string[] = [];
    const ops = new OpsAlertService({
      cooldownMs: 1,
      send: async (c) => {
        sent.push(c);
        return true;
      },
    });
    const pool = {
      query: jest.fn(async () => {
        throw new Error('no pg');
      }),
      end: jest.fn(async () => undefined),
    };
    const svc = new ArchiveService({} as any, pool as any, ops);
    const res = await svc.runQualityChecks({
      sensitiveHits: 0,
      refusals: 1,
      total: 10,
      p95LatencyMs: 100,
    });
    expect(res.alerts).toEqual([]);
    expect(sent).toEqual([]);
  });
});
