/**
 * 验收：MODEL_MODE=local 时仍走 FastGPT RAG（本地模型作为 FastGPT 渠道），
 * 且 FastGPT 失败时不做云端直连回退。
 *
 * 依赖 TEST_PG_URL；未设置则 skip。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { WecomCrypto } from '../../src/wecom/wecom-crypto.js';
import { applyMigrations } from '../__setup__/migrations.js';
import { setConfig } from '../__setup__/inject-config.js';
import { resetConfig } from '../__setup__/test-helpers.js';

jest.setTimeout(90_000);
const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

jest.mock('ioredis', () => {
  const mod = require('ioredis-mock');
  const RedisCtor = mod.default ?? mod;
  return { Redis: RedisCtor, default: RedisCtor };
});

jest.mock('axios', () => {
  const g = globalThis as any;
  g.__ax = { directLlmCalls: 0, fastgptCalls: 0, sendCalls: 0, sent: [] as string[], fastgptFail: false };
  const post = jest.fn(async (url: string, body?: any) => {
    if (typeof url === 'string' && url.includes('/api/v1/chat/completions')) {
      if (g.__ax.fastgptFail) throw new Error('fastgpt down');
      g.__ax.fastgptCalls += 1;
      return { data: { data: [{ score: 0.9, content: '本地RAG答案' }], choices: [{ message: { content: '本地RAG答案' } }] } };
    }
    // 直连 LLM（本地或云）——local 模式下一律不应出现
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      g.__ax.directLlmCalls += 1;
      return { data: { choices: [{ message: { content: '直连答案' } }] } };
    }
    if (typeof url === 'string' && url.includes('gettoken')) {
      return { data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } };
    }
    g.__ax.sendCalls += 1;
    if (typeof body?.text?.content === 'string') g.__ax.sent.push(body.text.content);
    return { data: { errcode: 0 } };
  });
  const get = jest.fn(async () => ({ data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } }));
  const api = { post, get };
  const factory = () => api;
  return { create: factory, default: { create: factory } };
});

suite('验收：local 模式保留 RAG 且不出站', () => {
  let pool: Pool;
  let app: any;
  const state = { msg: null as any };
  const fakeCrypto = {
    randomUUID: () => `trace-local-${Date.now()}`,
    decryptMsg: async () => 'plain',
    parseXml: async () => state.msg,
  };
  const msg = (id: string) => ({
    ToUserName: 'corp', FromUserName: 'user-local', ChatId: 'chat-local',
    MsgType: 'text', Content: '本地模式问题', MsgId: id,
    CreateTime: Math.floor(Date.now() / 1000), mentioned: true,
  });
  const post = () => request(app.getHttpServer())
    .post('/wecom/callback?msg_signature=sig&timestamp=1&nonce=1')
    .send({ Encrypt: 'x' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      MODEL_MODE: 'local',
      LOCAL_LLM_BASE_URL: 'http://local-llm:8000/v1',
      LOCAL_LLM_MODEL: 'qwen-local',
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      LLM_RETRY_DELAY_MS: 0,
      RATE_USER_PER_MIN: 100,
      RATE_GROUP_PER_MIN: 100,
      LOG_LEVEL: 'silent',
      MOCK_QA_FILE: '', KEYWORDS_FILE: '', WECHAT_BOT_USER_ID: '',
      LICENSE_FILE: '/tmp/csbot-acceptance-no-license.lic',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WecomCrypto).useValue(fakeCrypto).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  it('local 成功：走 FastGPT RAG（本地渠道），无直连 LLM', async () => {
    const g = (globalThis as any).__ax;
    g.directLlmCalls = 0; g.fastgptCalls = 0; g.sendCalls = 0; g.sent = []; g.fastgptFail = false;
    state.msg = msg(`local-ok-${Date.now()}`);
    expect((await post()).status).toBe(200);
    const start = Date.now();
    while (Date.now() - start < 3000 && g.sendCalls < 1) await new Promise((r) => setTimeout(r, 25));
    expect(g.fastgptCalls).toBeGreaterThanOrEqual(1);
    expect(g.directLlmCalls).toBe(0);
    expect(g.sent.join('\n')).toContain('本地RAG答案');
  });

  it('local 下 FastGPT 失败：繁忙话术，不直连云', async () => {
    const g = (globalThis as any).__ax;
    g.directLlmCalls = 0; g.fastgptCalls = 0; g.sendCalls = 0; g.sent = []; g.fastgptFail = true;
    state.msg = msg(`local-fail-${Date.now()}`);
    expect((await post()).status).toBe(200);
    const start = Date.now();
    while (Date.now() - start < 3000 && g.sendCalls < 1) await new Promise((r) => setTimeout(r, 25));
    expect(g.directLlmCalls).toBe(0);
    expect(g.sent.join('\n')).toContain('系统繁忙');
  });
});
