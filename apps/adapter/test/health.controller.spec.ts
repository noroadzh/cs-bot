/**
 * HealthController 单元测试（src/health/health.controller.ts）
 *
 * controller 通过 DI 拿到 Redis / PgClient / LicenseService 三个依赖，
 * 依赖行为由 makeController 传入的 stub 直接驱动，不 mock 模块。
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller.js';
import { LicenseService } from '../src/license/license.service.js';
import { UsageService } from '../src/usage/usage.service.js';

interface Stub {
  ping: () => Promise<unknown>;
  query: (sql: string) => Promise<unknown>;
}

function makeLicense(s: { valid: boolean; mock?: boolean; reason?: string }) {
  return { verifyAndCache: jest.fn(() => Promise.resolve(s)) } as unknown as LicenseService;
}

/** 默认全好；deps 里列出的依赖改为 reject */
function makeController(
  licenseState: { valid: boolean; mock?: boolean; reason?: string },
  failing: { redis?: boolean; pg?: boolean } = {},
): HealthController {
  const redis = {
    ping: () => (failing.redis ? Promise.reject(new Error('redis down')) : Promise.resolve('PONG')),
  } as unknown as Stub;
  const pg = {
    query: (sql: string) => (failing.pg ? Promise.reject(new Error('pg down')) : Promise.resolve({ rows: [] })),
  } as unknown as Stub;
  const usage = {
    getUsage: () => ({
      period: 'daily',
      startedAt: '2026-10-27T00:00:00.000Z',
      counters: {
        messagesReceived: 10, messagesAnswered: 6, messagesMissed: 4,
        llmFailures: 1, messagesRefused: 0, messagesTriggered: 8,
        assetsSent: 0, tokensPrimary: 0, tokensFallback: 0,
        imagesReceived: 0, imagesRecognized: 0, imagesSkipped: 0,
        llmFailovers: 0,
      },
    }),
  } as unknown as UsageService;
  return new HealthController(makeLicense(licenseState), redis as never, pg as never, usage);
}

async function capture(fn: () => Promise<unknown>) {
  try {
    return { threw: false as const, res: (await fn()) as any };
  } catch (e) {
    return { threw: true as const, err: e as HttpException };
  }
}

describe('HealthController.check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('全部依赖正常 + license 有效 → 200 ok', async () => {
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect(out.threw).toBe(false);
    expect(out.res).toMatchObject({
      status: 'ok',
      license: { valid: true, mock: true },
      usage: { messagesReceived: 10, messagesAnswered: 6, messagesMissed: 4, llmFailures: 1 },
    });
  });

  it('redis ping 失败 → deps 含 redis，抛 503 degraded', async () => {
    const out = await capture(() => makeController({ valid: true, mock: true }, { redis: true }).check());
    expect((out as any).err.getStatus()).toBe(503);
    const body = (out as any).err.getResponse();
    expect(body.status).toBe('degraded');
    expect(body.deps).toEqual(['redis']);
  });

  it('pg query 失败 → deps 含 postgresql', async () => {
    const out = await capture(() => makeController({ valid: true, mock: true }, { pg: true }).check());
    expect((out as any).err.getResponse().deps).toEqual(['postgresql']);
  });

  it('redis + pg 双失败 → deps 同时含两者', async () => {
    const out = await capture(() => makeController({ valid: true, mock: true }, { redis: true, pg: true }).check());
    expect((out as any).err.getResponse().deps).toEqual(['redis', 'postgresql']);
  });

  it('依赖全好但 license 失效 → deps 仅含 license，license 字段被透传', async () => {
    const out = await capture(() => makeController({ valid: false, mock: false, reason: 'expired' }).check());
    const body = (out as any).err.getResponse();
    expect(body.deps).toEqual(['license']);
    expect(body.license).toEqual({ valid: false, mock: false, reason: 'expired' });
  });

  it('license 失效 + redis 不可达 → deps 含 redis 与 license', async () => {
    const out = await capture(() =>
      makeController({ valid: false, mock: false, reason: 'invalid signature' }, { redis: true }).check(),
    );
    const body = (out as any).err.getResponse();
    expect(body.deps).toEqual(['redis', 'license']);
    expect(body.license.reason).toBe('invalid signature');
  });

  it('pg query 用 SELECT 1 探活（不建连）', async () => {
    const query = jest.fn((_sql: string) => Promise.resolve({ rows: [] }));
    const usage = { getUsage: () => ({ counters: { messagesReceived: 0, messagesAnswered: 0, messagesMissed: 0, llmFailures: 0 } }) } as unknown as UsageService;
    const c = new HealthController(
      makeLicense({ valid: true, mock: true }),
      { ping: () => Promise.resolve('PONG') } as never,
      { query } as never,
      usage,
    );
    await capture(() => c.check());
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });
});
