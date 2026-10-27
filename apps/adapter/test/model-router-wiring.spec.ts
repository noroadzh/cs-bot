/**
 * 增项 D 接线：配置校验 + ModelRouter 构造 + provider 契约
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AppConfigSchema } from '../src/config/config.schema.js';
import { buildModelRouter, createHttpChatProvider } from '../src/qa/model-providers.js';
import { MOCK_CONFIG } from './__setup__/test-helpers.js';

jest.mock('axios', () => {
  const g = globalThis as any;
  g.__axCalls = [] as Array<{ baseURL: string; url: string; body: any }>;
  g.__axFail = new Set<string>();
  const create = (cfg: any) => ({
    post: async (url: string, body: any) => {
      g.__axCalls.push({ baseURL: cfg?.baseURL ?? '', url, body });
      if (g.__axFail.has(cfg?.baseURL)) throw new Error('provider down');
      const tag = String(cfg?.baseURL).includes('local') ? '本地答案' : '云答案';
      return { data: { choices: [{ message: { content: tag } }] } };
    },
  });
  return { create, default: { create } };
});

const baseCfg = {
  ...MOCK_CONFIG,
  LLM_PRIMARY_MODEL: 'deepseek-chat',
  LOCAL_LLM_BASE_URL: 'http://local-llm:8000/v1',
  LOCAL_LLM_API_KEY: '',
  LOCAL_LLM_MODEL: 'qwen-local',
  LOCAL_LLM_TIMEOUT_MS: 20000,
};

describe('model router wiring', () => {
  beforeEach(() => {
    const g = globalThis as any;
    g.__axCalls = [];
    g.__axFail = new Set<string>();
  });

  it('MODEL_MODE=local 缺 LOCAL_LLM_BASE_URL → schema 拒绝', () => {
    const r = AppConfigSchema.safeParse({
      ...process.env,
      MODEL_MODE: 'local',
      LOCAL_LLM_BASE_URL: '',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join('.') === 'LOCAL_LLM_BASE_URL')).toBe(true);
    }
  });

  it('MODEL_MODE=hybrid + 本地端点 → 构造路由器', () => {
    const router = buildModelRouter({ ...baseCfg, MODEL_MODE: 'hybrid' } as any);
    expect(router).not.toBeNull();
    expect(router!.getMode()).toBe('hybrid');
  });

  it('MODEL_MODE=cloud → 返回 null（沿用既有引擎）', () => {
    expect(buildModelRouter({ ...baseCfg, MODEL_MODE: 'cloud' } as any)).toBeNull();
  });

  it('local 失败 → 抛错且云通道零调用（不出站）', async () => {
    const g = globalThis as any;
    g.__axFail.add('http://local-llm:8000/v1');
    const router = buildModelRouter({ ...baseCfg, MODEL_MODE: 'local' } as any)!;
    await expect(router.chat('hi')).rejects.toThrow('provider down');
    expect(g.__axCalls.every((c: any) => String(c.baseURL).includes('local'))).toBe(true);
  });

  it('hybrid 本地失败 → 切云并标记 failover', async () => {
    const g = globalThis as any;
    g.__axFail.add('http://local-llm:8000/v1');
    const router = buildModelRouter({ ...baseCfg, MODEL_MODE: 'hybrid' } as any)!;
    const r = await router.chat('hi');
    expect(r.source).toBe('cloud');
    expect(r.failover).toBe(true);
    expect(r.text).toBe('云答案');
  });

  it('baseUrl 已含 /v1 时只追加 /chat/completions', async () => {
    const g = globalThis as any;
    const p = createHttpChatProvider({
      baseUrl: 'http://local-llm:8000/v1',
      apiKey: '',
      model: 'qwen-local',
      timeoutMs: 1000,
    });
    await p.chat('hi');
    expect(g.__axCalls[0].url).toBe('/chat/completions');
  });

  it('provider 使用 OpenAI 兼容路径与模型名', async () => {
    const g = globalThis as any;
    const p = createHttpChatProvider({
      baseUrl: 'http://local-llm:8000',
      apiKey: '',
      model: 'qwen-local',
      timeoutMs: 1000,
    });
    const text = await p.chat('hello');
    expect(text).toBe('本地答案');
    const call = g.__axCalls[0];
    expect(call.url).toBe('/v1/chat/completions');
    expect(call.body.model).toBe('qwen-local');
    expect(call.body.messages[0].content).toBe('hello');
  });
});
