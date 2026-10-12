/**
 * WecomCrypto 单元测试
 * 不依赖 Redis/axios——纯 crypto + xml2js
 */
import { setConfig, MOCK_CONFIG } from './__setup__/test-helpers.js';
import { WecomCrypto } from '../src/wecom/wecom-crypto.js';
import { createHash, randomBytes } from 'crypto';

let crypto: WecomCrypto;
let TOKEN: string;
let CORP_ID: string;

beforeAll(() => {
  setConfig({
    WECHAT_TOKEN: 'cs-bot-test-token',
    WECHAT_ENCODING_AES_KEY: 'A'.repeat(43),
    WECHAT_CORP_ID: 'ww-test-corp-id',
  });
  crypto = new WecomCrypto({} as any);
  TOKEN = 'cs-bot-test-token';
  CORP_ID = 'ww-test-corp-id';
});

describe('WecomCrypto', () => {
  describe('verifySignature', () => {
    it('验签通过：SHA1 正确', () => {
      const timestamp = '1700000000';
      const nonce = 'nonce123';
      const encrypt = 'fake-encrypt-text';
      const arr = [TOKEN, timestamp, nonce, encrypt].sort();
      const sig = createHash('sha1').update(arr.join('')).digest('hex');
      expect(crypto.verifySignature(sig, timestamp, nonce, encrypt)).toBe(true);
    });

    it('验签失败：签名错误', () => {
      expect(crypto.verifySignature('bad-sig', '1700000000', 'nonce', 'enc')).toBe(false);
    });
  });

  describe('encrypt/decrypt 往返', () => {
    it('buildPassiveReply 返回合法 envelope', () => {
      const from = 'user_openid';
      const to = CORP_ID;
      const content = '你好，客服消息';
      const xml = crypto.buildPassiveReply(from, to, content);
      expect(xml).toContain('<Encrypt>');
      expect(xml).toContain('<MsgSignature>');
      expect(xml).toContain('<TimeStamp>');
      expect(xml).toContain('<Nonce>');
    });
  });

  describe('parseXml', () => {
    it('正常 XML：返回 InboundMsg', async () => {
      const msg = await crypto.parseXml(
        '<xml><ToUserName>corp</ToUserName><FromUserName>user</FromUserName><CreateTime>1700000000</CreateTime><MsgType>text</MsgType><Content>hi</Content><MsgId>m1</MsgId></xml>',
        't-1'
      );
      expect(msg).not.toBeNull();
      expect(msg!.MsgType).toBe('text');
      expect(msg!.Content).toBe('hi');
    });

    it('损坏 XML：返回 null', async () => {
      const msg = await crypto.parseXml('<<<not xml>>>', 't-2');
      expect(msg).toBeNull();
    });

    it('@mention 检测：AtList 包含 corpId → mentioned=true', async () => {
      const corp = CORP_ID;
      const xml = `<xml><ToUserName>${corp}</ToUserName><FromUserName>u</FromUserName><CreateTime>1700000000</CreateTime><MsgType>text</MsgType><Content>@bot hi</Content><MsgId>m2</MsgId><AtList><item>${corp}</item></AtList></xml>`;
      const msg = await crypto.parseXml(xml, 't-3');
      expect(msg).not.toBeNull();
      expect(msg!.mentioned).toBe(true);
    });
  });
});
