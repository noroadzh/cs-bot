import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ModelRouterService } from '../src/qa/model-router.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import type { AskReq, AskResult } from '@cs-bot/shared';

describe('ModelRouterService', () => {
  beforeEach(() => setConfig({ MODEL_CATALOG_JSON: '[]', CONFIDENCE_THRESHOLD: 0.75 }));
  afterEach(() => resetConfig());

  it('primary 失败时 pickFallback 选次选', () => {
    const router = new ModelRouterService({} as any);
    router.register({ id: 'a', name: 'primary', baseUrl: 'http://a', latencyMs: 10 });
    router.register({ id: 'b', name: 'secondary', baseUrl: 'http://b', latencyMs: 20 });
    expect(router.pick('latency')?.id).toBe('a');
    expect(router.pickFallback('a')?.id).toBe('b');
  });

  it('微调产物登记进目录', () => {
    const router = new ModelRouterService({} as any);
    router.register({
      id: 'lora-1',
      name: 'cs-lora',
      baseUrl: 's3://art/lora-1',
      kind: 'lora',
      artifactUri: 's3://art/lora-1',
    });
    expect(router.list().some((m) => m.id === 'lora-1' && m.kind === 'lora')).toBe(true);
  });

  it('FastGPTQaEngine：primary 端点失败后重试 secondary', async () => {
    const router = new ModelRouterService({} as any);
    router.register({ id: 'a', name: 'primary', baseUrl: 'http://a', latencyMs: 10 });
    router.register({ id: 'b', name: 'secondary', baseUrl: 'http://b', latencyMs: 20 });

    const chat = jest.fn(async (body: { model?: string }) => {
      if (body.model === 'a') throw new Error('primary down');
      return { answer: 'from-b', quotes: [], score: 0.9 };
    });
    const primaryClient = {
      chat,
      forEndpoint: () => ({ chat }),
    };
    const approvedQa = { search: jest.fn(async () => null) };

    const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
    const { ConfigService } = await import('../src/config/config.service.js');
    const engine = new FastGPTQaEngine(
      ConfigService as any,
      approvedQa as any,
      primaryClient as any,
      router,
    );

    const req: AskReq = { traceId: 't', question: 'hi' };
    const res: AskResult = await engine.ask(req);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.value.answer).toBe('from-b');
    expect(res.value.source).toBe('fallback');
    expect(chat.mock.calls.some((c) => c[0].model === 'a')).toBe(true);
    expect(chat.mock.calls.some((c) => c[0].model === 'b')).toBe(true);
  });
});
