/**
 * HealthController 单元测试（src/health/health.controller.ts）
 *
 * controller 直接 new Redis / new PgClient，无法 DI 注入：
 * - ioredis-mock 在 lazyConnect: true 下 ping 不 resolve（5s 超时）
 * - pg 连 127.0.0.1:5432 等满 2s connectionTimeoutMillis
 * 因此 mock 两个模块，用 state 对象精确驱动每个分支。
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const state: {
  redisPing: null | (() => Promise<string>);
  pgConnect: null | (() => Promise<void>);
  pgQuery: null | (() => Promise<unknown>);
} = {
  redisPing: null,
  pgConnect: null,
  pgQuery: null,
};

jest.mock('ioredis', () => {
  return {
    Redis: class {
      constructor(public readonly opts: unknown) {}
      ping(): Promise<string> {
        return state.redisPing ? state.redisPing() : Promise.resolve('PONG');
      }
      disconnect(): void {}
    },
  };
});

jest.mock('pg', () => {
  return {
    Client: class {
      constructor(public readonly opts: unknown) {}
      connect(): Promise<void> {
        return state.pgConnect ? state.pgConnect() : Promise.resolve();
      }
      query(): Promise<unknown> {
        return state.pgQuery ? state.pgQuery() : Promise.resolve({ rows: [{ '?column?': 1 }] });
      }
      end(): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

import { HttpException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller.js';
import { LicenseService } from '../src/license/license.service.js';

function makeLicense(s: { valid: boolean; mock?: boolean; reason?: string }) {
  return { verifyAndCache: jest.fn(() => Promise.resolve(s)) } as any;
}

function makeController(licenseState: { valid: boolean; mock?: boolean; reason?: string }) {
  return new HealthController(makeLicense(licenseState) as unknown as LicenseService);
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
    state.redisPing = null;
    state.pgConnect = null;
    state.pgQuery = null;
    jest.clearAllMocks();
  });

  it('全部依赖正常 + license 有效 → 200 ok', async () => {
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect(out.threw).toBe(false);
    expect(out.res).toEqual({ status: 'ok', license: { valid: true, mock: true } });
  });

  it('redis ping 失败 → deps 含 redis，抛 503 degraded', async () => {
    state.redisPing = () => Promise.reject(new Error('ECONNREFUSED'));
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect((out as any).err.getStatus()).toBe(503);
    const body = (out as any).err.getResponse();
    expect(body.status).toBe('degraded');
    expect(body.deps).toEqual(['redis']);
  });

  it('pg connect 失败 → deps 含 postgresql', async () => {
    state.pgConnect = () => Promise.reject(new Error('pg down'));
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect((out as any).err.getResponse().deps).toEqual(['postgresql']);
  });

  it('pg connect 成功但 query 失败 → deps 含 postgresql', async () => {
    state.pgQuery = () => Promise.reject(new Error('query failed'));
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect((out as any).err.getResponse().deps).toEqual(['postgresql']);
  });

  it('redis + pg 双失败 → deps 同时含两者', async () => {
    state.redisPing = () => Promise.reject(new Error('redis down'));
    state.pgConnect = () => Promise.reject(new Error('pg down'));
    const out = await capture(() => makeController({ valid: true, mock: true }).check());
    expect((out as any).err.getResponse().deps).toEqual(['redis', 'postgresql']);
  });

  it('依赖全好但 license 失效 → deps 仅含 license，license 字段被透传', async () => {
    const out = await capture(() => makeController({ valid: false, mock: false, reason: 'expired' }).check());
    const body = (out as any).err.getResponse();
    expect(body.deps).toEqual(['license']);
    expect(body.license).toEqual({ valid: false, mock: false, reason: 'expired' });
  });

  it('license 失效 + redis 不可达 → deps 含 redis 与 license', async () => {
    state.redisPing = () => Promise.reject(new Error('redis down'));
    const out = await capture(() => makeController({ valid: false, mock: false, reason: 'invalid signature' }).check());
    const body = (out as any).err.getResponse();
    expect(body.deps).toEqual(['redis', 'license']);
    expect(body.license.reason).toBe('invalid signature');
  });
});
