/**
 * 验收测试：mock 全栈（真实 adapter + 真实 PG + 内存 Redis + FastGPT/企微 mock）
 *
 * 覆盖：
 * - 正常问答全链路（回调 → 触发 → 上下文 → QA → 置信度 → 过滤 → 回复）
 * - 低置信拒答 + miss_record 落库
 * - 去重幂等（同一 MsgId 只处理一次）
 * - 限流（单人 1/min 场景，超限不再回复）
 * - 授权受限模式（license 失效 → 拦截话术，不进 QA）
 * - 图片识别失败引导（下载/识别失败 → 引导话术，不把占位文本发给 QA）
 *
 * 依赖：TEST_PG_URL 指向可写 PostgreSQL；未设置则 skip。
 * Redis 由 test/__setup__/env.ts 全局替换为 ioredis-mock（进程内）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { applyMigrations } from '../__setup__/migrations.js';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { WecomCrypto } from '../../src/wecom/wecom-crypto.js';
import { ConfigService } from '../../src/config/config.service.js';
import { UsageService } from '../../src/usage/usage.service.js';
import { setConfig } from '../__setup__/inject-config.js';
import { resetConfig } from '../__setup__/test-helpers.js';

jest.setTimeout(90_000);

const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// 内存 Redis：jest 有自己的模块解析器，env.ts 的 _resolveFilename 补丁不生效，
// 这里显式把 ioredis 换成 ioredis-mock（进程内共享数据，支持 SET NX/INCR/EXPIRE）。
// ---------------------------------------------------------------------------
jest.mock('ioredis', () => {
  const mod = require('ioredis-mock');
  const RedisCtor = mod.default ?? mod;
  return { Redis: RedisCtor, default: RedisCtor };
});

// ---------------------------------------------------------------------------
// FastGPT / 企微 mock（axios）
// 状态挂在 globalThis 上：jest.mock 工厂会被提升到 import 之前执行。
// ---------------------------------------------------------------------------
const GUIDANCE_TEXT = '抱歉，暂时没看懂这张图片，麻烦用文字简述一下您的问题～';
const LICENSE_INVALID_TEXT =
  '本机器人的授权已失效或过期，暂时无法为您服务，请联系管理员处理。';

jest.mock('axios', () => {
  const g = globalThis as any;
  g.__ax = {
    score: 0.9,
    answer: '这是标准答案',
    failChat: false,
    chatCalls: 0,
    sendCalls: 0,
    sent: [] as string[],
  };
  const post = jest.fn(async (url: string, body?: any) => {
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      if (g.__ax.failChat) throw new Error('fastgpt down');
      g.__ax.chatCalls += 1;
      return {
        data: {
          data: [{ score: g.__ax.score, content: g.__ax.answer }],
          choices: [{ message: { content: g.__ax.answer } }],
        },
      };
    }
    if (typeof url === 'string' && url.includes('gettoken')) {
      return { data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } };
    }
    // 企微发送接口（/appchat/send 等）
    g.__ax.sendCalls += 1;
    const content = body?.text?.content;
    if (typeof content === 'string') g.__ax.sent.push(content);
    return { data: { errcode: 0 } };
  });
  const get = jest.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/media/get')) {
      throw new Error('media download failed');
    }
    return { data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } };
  });
  const api = { post, get };
  const factory = () => api;
  return { create: factory, default: { create: factory } };
});

async function waitFor(cond: () => Promise<boolean> | boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

suite('验收：mock 全栈问答链路', () => {
  let pool: Pool;
  let app: any;
  const ax = () => (globalThis as any).__ax;
  const fakeState: { msg: any } = { msg: null };

  const fakeCrypto = {
    randomUUID: () => `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    decryptMsg: async () => 'plain',
    parseXml: async () => fakeState.msg,
  };

  const baseMsg = (over: Record<string, unknown> = {}) => ({
    ToUserName: 'corp',
    FromUserName: 'user-1',
    ChatId: 'chat-1',
    MsgType: 'text',
    Content: '你好，怎么退款',
    MsgId: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    CreateTime: Math.floor(Date.now() / 1000),
    mentioned: true,
    ...over,
  });

  const post = () =>
    request(app.getHttpServer())
      .post('/wecom/callback?msg_signature=sig&timestamp=1&nonce=1')
      .send({ Encrypt: 'x' });

  const missCount = async () =>
    (await pool.query('SELECT count(*)::int AS n FROM miss_record')).rows[0].n;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    // 清理历史数据，保证计数从 0 开始
    await pool.query('DELETE FROM approved_qa');
    await pool.query('DELETE FROM miss_record');

    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      LLM_RETRY_DELAY_MS: 0,
      RATE_USER_PER_MIN: 5,
      RATE_GROUP_PER_MIN: 20,
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
    // UsageService 启动时会恢复 data/usage-snapshot.json（可能是旧日期），
    // 首次 getUsage() 会触发周期重置并清零计数；这里先归一化，避免首个用例读到 0。
    app.get(UsageService).getUsage();
  });

  afterAll(async () => {
    if (app) await app.close();
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  beforeEach(() => {
    const s = ax();
    s.score = 0.9;
    s.answer = '这是标准答案';
    s.failChat = false;
    s.chatCalls = 0;
    s.sendCalls = 0;
    s.sent = [];
  });

  it('1.2 企微签名工具：mock 签名向量与真实 WecomCrypto 校验一致', () => {
    const c = new WecomCrypto(ConfigService.instance);
    const ts = '1700000000';
    const nonce = 'abc';
    const enc = 'fake-cipher';
    const sig = createHash('sha1')
      .update([ConfigService.instance.WECHAT_TOKEN, ts, nonce, enc].sort().join(''))
      .digest('hex');
    expect(c.verifySignature(sig, ts, nonce, enc)).toBe(true);
    expect(c.verifySignature('wrong-sig', ts, nonce, enc)).toBe(false);
  });

  it('2.1 正常问答：回调 → QA → 回复，不写 miss_record', async () => {
    fakeState.msg = baseMsg({ ChatId: 'chat-normal', FromUserName: 'user-normal' });
    const before = await missCount();
    const res = await post();
    expect(res.status).toBe(200);

    await waitFor(() => ax().sendCalls >= 1);
    expect(ax().chatCalls).toBeGreaterThanOrEqual(1);
    expect(ax().sent.join('\n')).toContain('这是标准答案');
    expect(await missCount()).toBe(before);

    const usage = app.get(UsageService).getUsage();
    expect(usage.counters.messagesReceived).toBeGreaterThanOrEqual(1);
    expect(usage.counters.messagesAnswered).toBeGreaterThanOrEqual(1);
  });

  it('2.2a 低置信：拒答话术 + miss_record 落库', async () => {
    const s = ax();
    s.score = 0.1;
    s.answer = '不确定';
    fakeState.msg = baseMsg({ ChatId: 'chat-low', FromUserName: 'user-low', MsgId: 'low-1' });
    const before = await missCount();

    const res = await post();
    expect(res.status).toBe(200);

    await waitFor(async () => (await missCount()) === before + 1);
    await waitFor(() => ax().sendCalls >= 1);
    expect(ax().sent.join('\n')).toContain('抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。');

    const row = await pool.query(
      `SELECT chat_id, question, score, engine FROM miss_record WHERE chat_id = 'chat-low' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(row.rows[0].question).toBe('你好，怎么退款');
    expect(Number(row.rows[0].score)).toBeCloseTo(0.1, 4);
    expect(row.rows[0].engine).toBe('fastgpt');
  });

  it('2.2a2 FastGPT 5xx/超时降级：回系统繁忙话术，不写 miss_record', async () => {
    ax().failChat = true;
    const before = await missCount();
    fakeState.msg = baseMsg({ ChatId: 'chat-llm-down', FromUserName: 'user-llm-down', MsgId: 'llm-down-1' });
    const res = await post();
    expect(res.status).toBe(200);
    await waitFor(() => ax().sendCalls >= 1);
    expect(ax().sent.join('\n')).toContain('系统繁忙');
    expect(await missCount()).toBe(before);
  });

  it('2.2b 去重：同一 MsgId 重复回调只处理一次', async () => {
    const msg = baseMsg({ ChatId: 'chat-dedup', FromUserName: 'user-dedup', MsgId: 'dedup-1' });
    fakeState.msg = msg;
    await post();
    await waitFor(() => ax().sendCalls >= 1);
    const callsAfterFirst = ax().sendCalls;

    fakeState.msg = msg; // 同 MsgId 重推
    await post();
    await new Promise((r) => setTimeout(r, 200));
    expect(ax().sendCalls).toBe(callsAfterFirst);
  });

  it('2.2c 限流：单人 5/min，第 6 条不再回复', async () => {
    const chat = 'chat-rate-user';
    const user = 'user-rate';
    for (let i = 1; i <= 5; i++) {
      const before = ax().sendCalls;
      fakeState.msg = baseMsg({ ChatId: chat, FromUserName: user, MsgId: `rate-u-${i}` });
      await post();
      await waitFor(() => ax().sendCalls === before + 1);
    }
    const chatBefore6 = ax().chatCalls;
    fakeState.msg = baseMsg({ ChatId: chat, FromUserName: user, MsgId: 'rate-u-6' });
    await post();
    await new Promise((r) => setTimeout(r, 200));
    // 第 6 条不再进入 QA（限流提示话术不算作答）
    expect(ax().chatCalls).toBe(chatBefore6);
    expect(ax().sent.join('\n')).toContain('提问太频繁');
  });

  it('2.2d 限流：单群 20/min，第 21 条不再回复', async () => {
    const chat = 'chat-rate-group';
    for (let i = 1; i <= 20; i++) {
      const before = ax().sendCalls;
      fakeState.msg = baseMsg({ ChatId: chat, FromUserName: `group-user-${i}`, MsgId: `rate-g-${i}` });
      await post();
      await waitFor(() => ax().sendCalls === before + 1);
    }
    const chatBefore21 = ax().chatCalls;
    fakeState.msg = baseMsg({ ChatId: chat, FromUserName: 'group-user-21', MsgId: 'rate-g-21' });
    await post();
    await new Promise((r) => setTimeout(r, 200));
    // 第 21 条不再进入 QA；群提示 5 分钟去重
    expect(ax().chatCalls).toBe(chatBefore21);
  });

  it('2.2d2 语音/视频/文件：@机器人 → 引导话术 + miss_record(media_type)', async () => {
    for (const mediaType of ['voice', 'video', 'file'] as const) {
      const chatId = `chat-${mediaType}-${Date.now()}`;
      const before = ax().sendCalls;
      fakeState.msg = {
        ToUserName: 'corp', FromUserName: `user-${mediaType}`, ChatId: chatId,
        MsgType: mediaType, MediaId: `media-${mediaType}`, MsgId: `${mediaType}-1`,
        CreateTime: Math.floor(Date.now() / 1000), mentioned: true,
      };
      expect((await post()).status).toBe(200);
      await waitFor(() => ax().sendCalls === before + 1);
      expect(ax().sent.join('\n')).toContain('无法直接查看');
      await waitFor(async () => {
        const r = await pool.query(
          `SELECT count(*)::int AS n FROM miss_record WHERE chat_id = $1 AND media_type = $2`,
          [chatId, mediaType],
        );
        return r.rows[0].n === 1;
      });
    }
  });

  it('2.2d3 未 @ 的视频：静默且不落库', async () => {
    const chatId = `chat-quiet-${Date.now()}`;
    const before = ax().sendCalls;
    const missBefore = await missCount();
    fakeState.msg = {
      ToUserName: 'corp', FromUserName: 'user-quiet', ChatId: chatId,
      MsgType: 'video', MediaId: 'media-quiet', MsgId: `quiet-${Date.now()}`,
      CreateTime: Math.floor(Date.now() / 1000), mentioned: false,
    };
    expect((await post()).status).toBe(200);
    await new Promise((r) => setTimeout(r, 250));
    expect(ax().sendCalls).toBe(before);
    expect(await missCount()).toBe(missBefore);
  });

  it('2.2e 授权受限：license 失效时不进 QA，回复授权提示话术', async () => {
    const cfg = ConfigService.instance as any;
    const prev = cfg.USE_MOCK_LICENSE;
    cfg.USE_MOCK_LICENSE = false;
    try {
      fakeState.msg = baseMsg({ ChatId: 'chat-license', FromUserName: 'user-license', MsgId: 'lic-1' });
      const res = await post();
      expect(res.status).toBe(200);
      await waitFor(() => ax().sendCalls >= 1);
      expect(ax().sent.join('\n')).toContain(LICENSE_INVALID_TEXT);
      expect(ax().chatCalls).toBe(0);
    } finally {
      cfg.USE_MOCK_LICENSE = prev;
    }
  });

  it('2.2f 图片识别失败：下载失败 → 引导话术，不把占位文本发给 QA', async () => {
    fakeState.msg = {
      ToUserName: 'corp',
      FromUserName: 'user-img',
      ChatId: 'chat-img',
      MsgType: 'image',
      MediaId: 'media-1',
      MsgId: 'img-1',
      CreateTime: Math.floor(Date.now() / 1000),
      mentioned: true,
    };
    const res = await post();
    expect(res.status).toBe(200);
    await waitFor(() => ax().sendCalls >= 1);
    expect(ax().sent.join('\n')).toContain(GUIDANCE_TEXT);
    expect(ax().chatCalls).toBe(0);

    const usage = app.get(UsageService).getUsage();
    expect(usage.counters.imagesSkipped).toBeGreaterThanOrEqual(1);
  });
});
