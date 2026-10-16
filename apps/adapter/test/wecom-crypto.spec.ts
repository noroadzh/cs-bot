/**
 * WecomCrypto 单元测试（src/wecom/wecom-crypto.ts）
 *
 * 注意：WecomCrypto 构造函数从 ConfigService.instance 读取配置（不是 process.env），
 * 且 test/__setup__/env.ts 已在 setupFiles 阶段注入 _instance，
 * 因此这里直接从 ConfigService.instance 读取真实生效值来构造签名。
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { createHash, createCipheriv, randomBytes } from 'crypto';
import { WecomCrypto } from '../src/wecom/wecom-crypto.js';
import { ConfigService } from '../src/config/config.service.js';

const cfg = ConfigService.instance;
const TOKEN = cfg.WECHAT_TOKEN;
const CORP_ID = cfg.WECHAT_CORP_ID;
const ENCODING_AES_KEY = cfg.WECHAT_ENCODING_AES_KEY;

function makeCrypto(): WecomCrypto {
  return new WecomCrypto(ConfigService.instance);
}

function sign(ts: string, nonce: string, encrypt: string): string {
  return createHash('sha1').update([TOKEN, ts, nonce, encrypt].sort().join('')).digest('hex');
}

/** 按企微 WXBizMsgCrypt 规范加密一段 XML */
function encryptXml(xml: string, corpId: string): string {
  const aesKey = Buffer.from(ENCODING_AES_KEY + '=', 'base64');
  const iv = aesKey.subarray(0, 16);
  const contentBytes = Buffer.from(xml, 'utf8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(contentBytes.length, 0);
  const raw = Buffer.concat([randomBytes(16), msgLen, contentBytes, Buffer.from(corpId, 'utf8')]);
  const padLen = 16 - (raw.length % 16);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
}

describe('WecomCrypto', () => {
  beforeAll(() => {
    expect(TOKEN).toBeTruthy();
    expect(CORP_ID).toBeTruthy();
    expect(ENCODING_AES_KEY).toHaveLength(43);
  });

  describe('verifySignature', () => {
    it('签名匹配 → true', () => {
      const c = makeCrypto();
      const ts = '1700000000';
      const nonce = 'abc';
      const enc = 'fake-cipher';
      expect(c.verifySignature(sign(ts, nonce, enc), ts, nonce, enc)).toBe(true);
    });

    it('签名不匹配 → false', () => {
      const c = makeCrypto();
      expect(c.verifySignature('wrong-sig', '1700000000', 'abc', 'fake-cipher')).toBe(false);
    });
  });

  describe('decryptMsg', () => {
    it('签名错误 → null（不进入解密）', async () => {
      const c = makeCrypto();
      expect(await c.decryptMsg('bad-sig', '1700000000', 'abc', encryptXml('<xml/>', CORP_ID))).toBeNull();
    });

    it('签名正确 + ReceiveId 匹配 corpId → 返回明文 XML', async () => {
      const c = makeCrypto();
      const xml = `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><Content>hello</Content></xml>`;
      const enc = encryptXml(xml, CORP_ID);
      const ts = '1700000000';
      const nonce = 'xyz';
      expect(await c.decryptMsg(sign(ts, nonce, enc), ts, nonce, enc)).toBe(xml);
    });

    it('ReceiveId 不等于 corpId → null', async () => {
      const c = makeCrypto();
      const xml = '<xml><ToUserName><![CDATA[other-corp]]></ToUserName><Content>hi</Content></xml>';
      const enc = encryptXml(xml, 'other-corp');
      const ts = '1700000000';
      const nonce = 'n1';
      expect(await c.decryptMsg(sign(ts, nonce, enc), ts, nonce, enc)).toBeNull();
    });

    it('解密/解析抛异常 → catch → null', async () => {
      const c = makeCrypto();
      const ts = '1700000000';
      const nonce = 'n2';
      const enc = Buffer.from('not-a-valid-aes-payload-at-all').toString('base64');
      expect(await c.decryptMsg(sign(ts, nonce, enc), ts, nonce, enc)).toBeNull();
    });
  });

  describe('parseXml', () => {
    it('完整文本消息 → 字段映射正确', async () => {
      const c = makeCrypto();
      const xml = `<xml>
<ToUserName><![CDATA[wxcorp]]></ToUserName>
<FromUserName><![CDATA[user1]]></FromUserName>
<ChatId><![CDATA[chat-99]]></ChatId>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[你好]]></Content>
<MsgId><![CDATA[123456]]></MsgId>
<CreateTime>1700000000</CreateTime>
</xml>`;
      const m = await c.parseXml(xml, 'trace-1');
      expect(m).not.toBeNull();
      expect(m!.traceId).toBe('trace-1');
      expect(m!.ToUserName).toBe('wxcorp');
      expect(m!.FromUserName).toBe('user1');
      expect(m!.ChatId).toBe('chat-99');
      expect(m!.MsgType).toBe('text');
      expect(m!.Content).toBe('你好');
      expect(m!.MsgId).toBe('123456');
      expect(m!.CreateTime).toBe(1700000000);
      expect(m!.text).toBe('你好');
    });

    it('缺失可选字段（ChatId/MsgId/MediaId）→ undefined 分支', async () => {
      const c = makeCrypto();
      const xml = `<xml>
<ToUserName><![CDATA[wxcorp]]></ToUserName>
<FromUserName><![CDATA[user1]]></FromUserName>
<MsgType><![CDATA[text]]></MsgType>
<Content>hi</Content>
</xml>`;
      const m = await c.parseXml(xml, 'trace-2');
      expect(m!.ChatId).toBeUndefined();
      expect(m!.MsgId).toBeUndefined();
      expect(m!.MediaId).toBeUndefined();
      expect(m!.CreateTime).toBe(0);
      expect(m!.mentioned).toBe(false);
    });

    it('AtList 嵌套 item 数组 → 命中 corpId 时 mentioned=true', async () => {
      const c = makeCrypto();
      const xml = `<xml>
<ToUserName><![CDATA[wxcorp]]></ToUserName>
<FromUserName><![CDATA[user1]]></FromUserName>
<MsgType><![CDATA[text]]></MsgType>
<Content>hi</Content>
<CreateTime>1700000000</CreateTime>
<AtList><item>other</item><item>${CORP_ID}</item></AtList>
</xml>`;
      const m = await c.parseXml(xml, 'trace-3');
      expect(m!.mentioned).toBe(true);
    });

    it('AtList 单个（非数组）→ 走 else 分支', async () => {
      const c = makeCrypto();
      const xml = `<xml>
<ToUserName><![CDATA[wxcorp]]></ToUserName>
<FromUserName><![CDATA[user1]]></FromUserName>
<MsgType><![CDATA[text]]></MsgType>
<Content>hi</Content>
<CreateTime>1700000000</CreateTime>
<AtList>${CORP_ID}</AtList>
</xml>`;
      const m = await c.parseXml(xml, 'trace-4');
      expect(m!.mentioned).toBe(true);
    });

    it('语音消息（无 Content，有 Recognition）→ text 取识别结果', async () => {
      const c = makeCrypto();
      const xml = `<xml>
<ToUserName><![CDATA[wxcorp]]></ToUserName>
<FromUserName><![CDATA[user1]]></FromUserName>
<MsgType><![CDATA[voice]]></MsgType>
<Recognition><![CDATA[语音转文字]]></Recognition>
<CreateTime>1700000000</CreateTime>
</xml>`;
      const m = await c.parseXml(xml, 'trace-5');
      expect(m!.Content).toBeUndefined();
      expect(m!.text).toBe('语音转文字');
    });

    it('非法 XML → catch → null', async () => {
      const c = makeCrypto();
      expect(await c.parseXml('<<<not-xml', 'trace-bad')).toBeNull();
    });
  });

  describe('buildPassiveReply', () => {
    it('返回含 Encrypt/MsgSignature/TimeStamp/Nonce 的 XML 骨架', () => {
      const c = makeCrypto();
      const xml = c.buildPassiveReply('fromUser', 'toUser', 'hello');
      expect(xml).toContain('<Encrypt>');
      expect(xml).toContain('<MsgSignature>');
      expect(xml).toContain('<TimeStamp>');
      expect(xml).toContain('<Nonce>');
      expect(xml.trimEnd().endsWith('</xml>')).toBe(true);
    });

    it('两次生成 → 加密体不同（randomBytes 注入）', () => {
      const c = makeCrypto();
      const a = c.buildPassiveReply('f', 't', 'same content');
      const b = c.buildPassiveReply('f', 't', 'same content');
      const aEnc = a.match(/<Encrypt><!\[CDATA\[([^\]]+)\]\]><\/Encrypt>/)?.[1];
      const bEnc = b.match(/<Encrypt><!\[CDATA\[([^\]]+)\]\]><\/Encrypt>/)?.[1];
      expect(aEnc).toBeTruthy();
      expect(bEnc).toBeTruthy();
      expect(aEnc).not.toBe(bEnc);
    });
  });
});
