/**
 * 验收：真实企微签名 + 加密消息走 HTTP 回调（不覆盖 WecomCrypto）
 *
 * 覆盖：
 * - 按 WXBizMsgCrypt 规范构造 AES-CBC 密文与 SHA1 签名 → POST /wecom/callback
 * - 合法签名 → 200，消息进入链路并回复
 * - 非法签名 → 401
 *
 * 与 full-chain.spec.ts 的区别：这里不替换 WecomCrypto，
 * 真实走「验签 → 解密 → XML 解析」路径，补足设计 D3 的签名验收口径。
 *
 * 依赖：TEST_PG_URL；未设置则 skip。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { ConfigService } from '../../src/config/config.service.js';
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
  g.__ax = { sendCalls: 0, sent: [] as string[], answer: '真实签名链路答案' };
  const post = jest.fn(async (url: string, body?: any) => {
    if (typeof url === 'string' && url.includes('/chat/completions')) {
      return {
        data: {
          data: [{ score: 0.9, content: g.__ax.answer }],
          choices: [{ message: { content: g.__ax.answer } }],
        },
      };
    }
    if (typeof url === 'string' && url.includes('gettoken')) {
      return { data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } };
    }
    g.__ax.sendCalls += 1;
    const content = body?.text?.content;
    if (typeof content === 'string') g.__ax.sent.push(content);
    return { data: { errcode: 0 } };
  });
  const get = jest.fn(async () => ({ data: { errcode: 0, access_token: 'mock-token', expires_in: 7200 } }));
  const api = { post, get };
  const factory = () => api;
  return { create: factory, default: { create: factory } };
});

suite('验收：企微真实签名回调', () => {
  let pool: Pool;
  let app: any;

  const cfg = () => ConfigService.instance;

  /** 企微 WXBizMsgCrypt：AES-256-CBC + PKCS#7 手动补齐 */
  function encryptXml(xml: string): string {
    const aesKey = Buffer.from(cfg().WECHAT_ENCODING_AES_KEY + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const contentBytes = Buffer.from(xml, 'utf8');
    const msgLen = Buffer.alloc(4);
    msgLen.writeUInt32BE(contentBytes.length, 0);
    const raw = Buffer.concat([
      randomBytes(16),
      msgLen,
      contentBytes,
      Buffer.from(cfg().WECHAT_CORP_ID, 'utf8'),
    ]);
    const padLen = 16 - (raw.length % 16);
    const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
    const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
  }

  function sign(ts: string, nonce: string, encrypt: string): string {
    return createHash('sha1')
      .update([cfg().WECHAT_TOKEN, ts, nonce, encrypt].sort().join(''))
      .digest('hex');
  }

  function signedBody(msgId: string) {
    const xml = `<xml>
<ToUserName><![CDATA[${cfg().WECHAT_CORP_ID}]]></ToUserName>
<FromUserName><![CDATA[user-sig]]></FromUserName>
<ChatId><![CDATA[chat-sig]]></ChatId>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[你好，怎么退款]]></Content>
<MsgId><![CDATA[${msgId}]]></MsgId>
<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
<AtList><item><![CDATA[${cfg().WECHAT_CORP_ID}]]></item></AtList>
</xml>`;
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(6).toString('hex');
    const encrypt = encryptXml(xml);
    return { ts, nonce, encrypt, sig: sign(ts, nonce, encrypt) };
  }

  const postSigned = (b: { ts: string; nonce: string; encrypt: string; sig: string }) =>
    request(app.getHttpServer())
      .post(`/wecom/callback?msg_signature=${b.sig}&timestamp=${b.ts}&nonce=${b.nonce}`)
      .send({ Encrypt: b.encrypt });

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);

    setConfig({
      DATABASE_URL: PG_URL,
      USE_MOCK_LLM: false,
      USE_MOCK_LICENSE: true,
      CONFIDENCE_THRESHOLD: 0.75,
      SEGMENT_GAP_MS: 0,
      RATE_USER_PER_MIN: 100,
      RATE_GROUP_PER_MIN: 100,
      LOG_LEVEL: 'silent',
      MOCK_QA_FILE: '',
      KEYWORDS_FILE: '',
      WECHAT_BOT_USER_ID: '',
      LICENSE_FILE: '/tmp/csbot-acceptance-no-license.lic',
      MODEL_MODE: 'cloud',
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  it('合法签名 + 加密消息 → 200，真实解密后进入链路并回复', async () => {
    const g = (globalThis as any).__ax;
    g.sendCalls = 0;
    g.sent = [];

    const res = await postSigned(signedBody(`sig-${Date.now()}`));
    expect(res.status).toBe(200);

    const start = Date.now();
    while (Date.now() - start < 3000 && g.sendCalls < 1) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(g.sendCalls).toBeGreaterThanOrEqual(1);
    expect(g.sent.join('\n')).toContain('真实签名链路答案');
  });

  it('非法签名 → 401，且不进入链路', async () => {
    const g = (globalThis as any).__ax;
    const before = g.sendCalls;
    const body = signedBody(`sig-bad-${Date.now()}`);
    const res = await request(app.getHttpServer())
      .post(`/wecom/callback?msg_signature=wrong&timestamp=${body.ts}&nonce=${body.nonce}`)
      .send({ Encrypt: body.encrypt });
    expect(res.status).toBe(401);
    await new Promise((r) => setTimeout(r, 100));
    expect(g.sendCalls).toBe(before);
  });
});
