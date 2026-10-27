/**
 * 企微消息加解密
 * 实现 WXBizMsgCrypt 算法（SHA1 签名 + AES-CBC 解密）
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import { ConfigService } from '../config/config.service.js';
import type { AppConfigInput } from '../config/config.schema.js';

const parseXmlAsync = promisify(parseString) as (xml: string) => Promise<any>;

/**
 * xml2js 默认 explicitArray:true，单值文本节点解析为 [value]，多值节点为 [v1,v2]。
 * 归一化为字符串（多值取首元素 + # 拼接以便排查），调用方可安全 String()。
 */
function scalar(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    return v.map((x) => (typeof x === 'string' ? x : String(x))).join('#');
  }
  return typeof v === 'string' ? v : String(v);
}

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
  /** 原始 @ 列表（userid/标识），便于排查真实回调结构 */
  atList?: string[];
}

export class WecomCrypto {
  private readonly token: string;
  private readonly encodingAesKey: string;
  private readonly corpId: string;
  private readonly botUserId: string;
  private readonly botName: string;

  constructor(config?: AppConfigInput) {
    const cfg = config ?? ConfigService.instance;
    this.token = cfg.WECHAT_TOKEN;
    this.encodingAesKey = cfg.WECHAT_ENCODING_AES_KEY;
    this.corpId = cfg.WECHAT_CORP_ID;
    this.botUserId = cfg.WECHAT_BOT_USER_ID ?? '';
    this.botName = cfg.WECHAT_BOT_NAME ?? '';
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
      // xml2js 默认 explicitArray:true，单值节点会解析成 ['x']，需归一化为字符串再比对
      const receiveid = scalar(m.ReceiveId ?? m.ToUserName);
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
      const atList = Array.isArray(m.AtList) ? m.AtList : (m.AtList ? [m.AtList] : []);
      const contentText = m.Content ? String(m.Content) : '';
      // 兼容嵌套结构：<AtList><item>x</item></AtList> 解析后为 [{ item: [x] }]
      const flatAtList: string[] = [];
      for (const entry of atList) {
        if (entry && typeof entry === 'object' && 'item' in entry && Array.isArray((entry as any).item)) {
          for (const v of (entry as any).item) flatAtList.push(String(v));
        } else {
          flatAtList.push(String(entry));
        }
      }
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
        mentioned:
          flatAtList.includes(this.corpId) ||
          (this.botUserId !== '' && flatAtList.includes(this.botUserId)) ||
          (this.botName !== '' && contentText.includes(`@${this.botName}`)),
        atList: flatAtList,
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
    const raw = Buffer.concat([random, msgLen, contentBytes, corpIdBytes]);
    // PKCS#7 块对齐填充（autoPadding=false 下需手动补齐到 16 字节倍数）
    const blockSize = 16;
    const padLen = blockSize - (raw.length % blockSize);
    const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);
    const aesKey = Buffer.from(this.encodingAesKey + '=', 'base64');
    const iv = aesKey.subarray(0, 16);
    const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
    cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64');
  }
}
