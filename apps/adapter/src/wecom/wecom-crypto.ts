/**
 * 企微消息加解密
 * 实现 WXBizMsgCrypt 算法（SHA1 签名 + AES-CBC 解密）
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import { ConfigService } from '../config/config.service.js';

const parseXmlAsync = promisify(parseString) as (xml: string) => Promise<any>;

export interface InboundMsg {
  traceId?: string;
  ToUserName: string;
  FromUserName: string;
  ChatId?: string;
  MsgType: string;
  Content?: string;
  MsgId?: string;
  MediaId?: string;
  CreateTime: number;
  text?: string;
  mentioned?: boolean;
}

export class WecomCrypto {
  private readonly token: string;
  private readonly encodingAesKey: string;
  private readonly corpId: string;

  constructor(config: ConfigService) {
    const cfg = ConfigService.instance;
    this.token = cfg.WECHAT_TOKEN;
    this.encodingAesKey = cfg.WECHAT_ENCODING_AES_KEY;
    this.corpId = cfg.WECHAT_CORP_ID;
  }

  verifySignature(msgSignature: string, timestamp: string, nonce: string, encrypt: string): boolean {
    const arr = [this.token, timestamp, nonce, encrypt].sort();
    const str = arr.join('');
    const sha1 = createHash('sha1').update(str).digest('hex');
    return sha1 === msgSignature;
  }

  private decryptAes(encryptStr: string): string {
    const aesKey = Buffer.from(this.encodingAesKey + '=', 'base64');
    const encrypted = Buffer.from(encryptStr, 'base64');
    const iv = aesKey.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const msgLen = decrypted.readUInt32BE(16);
    return decrypted.subarray(20, 20 + msgLen).toString('utf8');
  }

  async decryptMsg(
    msgSignature: string,
    timestamp: string,
    nonce: string,
    encrypt: string,
  ): Promise<string | null> {
    if (!this.verifySignature(msgSignature, timestamp, nonce, encrypt)) return null;
    try {
      const text = this.decryptAes(encrypt);
      const xml = await parseXmlAsync(text);
      const m: any = xml?.xml ?? {};
      const receiveid = m.ReceiveId ?? m.ToUserName ?? '';
      if (receiveid !== this.corpId) return null;
      return text;
    } catch {
      return null;
    }
  }

  async parseXml(xmlText: string, traceId: string): Promise<InboundMsg | null> {
    try {
      const xml = await parseXmlAsync(xmlText);
      const m: any = xml?.xml ?? {};
      const atList = Array.isArray(m.AtList) ? m.AtList.map(String) : (typeof m.AtList === 'string' ? [m.AtList] : []);
      return {
        traceId,
        ToUserName: String(m.ToUserName ?? ''),
        FromUserName: String(m.FromUserName ?? ''),
        ChatId: m.ChatId ? String(m.ChatId) : undefined,
        MsgType: String(m.MsgType ?? ''),
        Content: m.Content ? String(m.Content) : undefined,
        MsgId: m.MsgId ? String(m.MsgId) : undefined,
        MediaId: m.MediaId ? String(m.MediaId) : undefined,
        CreateTime: parseInt(String(m.CreateTime ?? '0'), 10),
        text: m.Content ? String(m.Content) : (m.Recognition ? String(m.Recognition) : undefined),
        mentioned: atList.includes(this.corpId),
      };
    } catch {
      return null;
    }
  }

  buildPassiveReply(from: string, to: string, content: string): string {
    return `<xml>
<Encrypt><![CDATA[${this.encryptForReply(content, from, to)}]]></Encrypt>
<MsgSignature><![CDATA[${this.token}]]></MsgSignature>
<TimeStamp>${Math.floor(Date.now() / 1000)}</TimeStamp>
<Nonce><![CDATA[${randomBytes(8).toString('hex')}]]></Nonce>
</xml>`;
  }

  private encryptForReply(content: string, from: string, to: string): string {
    const random = randomBytes(16);
    const contentBytes = Buffer.from(content, 'utf8');
    const msgLen = Buffer.alloc(4);
    msgLen.writeUInt32BE(contentBytes.length, 0);
    const corpIdBytes = Buffer.from(this.corpId, 'utf8');
    const plaintext = Buffer.concat([random, msgLen, contentBytes, corpIdBytes]);
    const aesKey = Buffer.from(this.encodingAesKey + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
  }
}
