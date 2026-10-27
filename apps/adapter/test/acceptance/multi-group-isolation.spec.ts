/**
 * 验收：一个机器人服务多个群时的隔离
 * - 同一用户在不同群：回复目标正确、上下文互不串
 * - 同一群不同用户：上下文隔离、@ 正确
 * - 群消息缺 ChatId：严格模式丢弃并计数，不私聊回复
 *
 * 依赖 TEST_PG_URL；未设置则 skip。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { WecomCrypto } from '../../src/wecom/wecom-crypto.js';
import { UsageService } from '../../src/usage/usage.service.js';
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
  g.__mg = { calls: [] as any[], sends: [] as any[] };
  const post = jest.fn(async (url: string, body?: any) => {
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      g.__mg.calls.push(body);
      const q = body?.messages?.[0]?.content ?? '';
      return {
        data: {
          choices: [{ message: { content: `A:${q}` } }],
          data: [{ score: 0.9 }],
        },
      };
    }
    if (typeof url === 'string' && url.includes('gettoken')) {
      return { data: { errcode: 0, access_token: 'tok', expires_in: 7200 } };
    }
    g.__mg.sends.push(body);
    return { data: { errcode: 0 } };
  });
  const get = jest.fn(async () => ({ data: { errcode: 0, access_token: 'tok', expires_in: 7200 } }));
  const api = { post, get };
  const factory = () => api;
  return { create: factory, default: { create: factory } };
});

async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('waitFor timeout');
}

suite('验收：多群隔离', () => {
  let pool: Pool;
  let app: any;
  const state: { msg: any } = { msg: null };
  const fakeCrypto = {
    randomUUID: () => `trace-${Date.now()}`,
    decryptMsg: async () => 'plain',
    parseXml: async () => state.msg,
  };
  const g = () => (globalThis as any).__mg;

  const msg = (chatId: string | undefined, userId: string, text: string, msgId: string): any => ({
    ToUserName: 'corp',
    FromUserName: userId,
    ...(chatId ? { ChatId: chatId } : {}),
    MsgType: 'text',
    Content: text,
    MsgId: msgId,
    CreateTime: Math.floor(Date.now() / 1000),
    mentioned: true,
  });

  const post = () =>
    request(app.getHttpServer())
      .post('/wecom/callback?msg_signature=sig&timestamp=1&nonce=1')
      .send({ Encrypt: 'x' });

  const send = async (m: any) => {
    const before = g().sends.length;
    state.msg = m;
    expect((await post()).status).toBe(200);
    await waitFor(() => g().sends.length > before);
    return g().sends[g().sends.length - 1];
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      REQUIRE_GROUP_CHAT_ID: true,
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      LLM_RETRY_DELAY_MS: 0,
      RATE_USER_PER_MIN: 100,
      RATE_GROUP_PER_MIN: 100,
      LOG_LEVEL: 'silent',
      MOCK_QA_FILE: '',
      KEYWORDS_FILE: '',
      WECHAT_BOT_USER_ID: '',
      LICENSE_FILE: '/tmp/csbot-acceptance-no-license.lic',
      MODEL_MODE: 'cloud',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WecomCrypto)
      .useValue(fakeCrypto)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  beforeEach(() => {
    g().calls = [];
    g().sends = [];
  });

  it('同一用户在不同群：回复到各自群，上下文互不串', async () => {
    const user = 'user-multi';
    const a1 = await send(msg('chat-A', user, 'A1', 'mg-a1'));
    expect(a1).toMatchObject({ chatid: 'chat-A' });
    expect(a1.text.content).toBe('A:A1');

    const b1 = await send(msg('chat-B', user, 'B1', 'mg-b1'));
    expect(b1).toMatchObject({ chatid: 'chat-B' });
    expect(b1.text.content).toBe('A:B1');

    // B 的第一次请求不应带 A 的上下文
    const bCall = g().calls.find((c: any) => c.messages?.[0]?.content === 'B1');
    expect(bCall.histories).toEqual([]);

    const a2 = await send(msg('chat-A', user, 'A2', 'mg-a2'));
    expect(a2).toMatchObject({ chatid: 'chat-A' });
    const aCall = g().calls.find((c: any) => c.messages?.[0]?.content === 'A2');
    expect(aCall.histories).toEqual([
      { role: 'user', content: 'A1' },
      { role: 'assistant', content: 'A:A1' },
    ]);
  });

  it('同一群不同用户：上下文隔离、@ 提问人正确', async () => {
    const u1 = await send(msg('chat-shared', 'user-1', 'U1', 'mg-u1'));
    expect(u1).toMatchObject({ chatid: 'chat-shared', atuserlist: 'user-1' });

    const u2 = await send(msg('chat-shared', 'user-2', 'U2', 'mg-u2'));
    expect(u2).toMatchObject({ chatid: 'chat-shared', atuserlist: 'user-2' });

    const u2Call = g().calls.find((c: any) => c.messages?.[0]?.content === 'U2');
    expect(u2Call.histories).toEqual([]);
  });

  it('群消息缺 ChatId：严格模式丢弃、计数，且不私聊回复', async () => {
    const beforeSends = g().sends.length;
    const beforeDropped = app.get(UsageService).getUsage().counters.messagesDroppedNoChatId;
    state.msg = msg(undefined, 'user-no-chat', '无群标识', 'mg-no-chat');
    expect((await post()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));
    expect(g().sends.length).toBe(beforeSends);
    const after = app.get(UsageService).getUsage();
    expect(after.counters.messagesDroppedNoChatId).toBe(beforeDropped + 1);
  });
});
