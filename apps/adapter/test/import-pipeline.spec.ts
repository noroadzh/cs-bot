/**
 * M10 重管线核心算法单测：清洗 / 配对 / 嗅探 / 黑名单
 */
import { describe, it, expect } from '@jest/globals';
import { ImportCleaner, type CleanMessage } from '../src/import/import-cleaner.js';
import { QaPairing } from '../src/import/qa-pairing.js';
import { sniffShape, UnrecognizedShapeError } from '../src/import/content-sniffer.js';
import { ImportBlacklist } from '../src/import/import-blacklist.js';

const msg = (over: Partial<CleanMessage>): CleanMessage => ({
  conversationId: 'c1',
  senderId: 'u1',
  senderType: 'customer',
  content: '你好请问怎么退款',
  occurredAt: 0,
  ...over,
});

describe('ImportCleaner', () => {
  const cleaner = new ImportCleaner();

  it('剔除系统/占位/机器人消息', () => {
    const out = cleaner.clean([
      msg({ senderType: 'system', content: '张三加入了群聊' }),
      msg({ senderType: 'bot', content: '我是机器人回复内容' }),
      msg({ content: '[图片]' }),
      msg({ content: '正常的问题内容' }),
    ]);
    expect(out.map((m) => m.content)).toEqual(['正常的问题内容']);
  });

  it('60s 内同发送方重复仅留 1 条', () => {
    const out = cleaner.clean([
      msg({ content: '重复的问题内容', occurredAt: 1000 }),
      msg({ content: '重复的问题内容', occurredAt: 2000 }),
      msg({ content: '重复的问题内容', occurredAt: 70_000 }),
    ]);
    expect(out).toHaveLength(2); // 第一次 + 70s 后（超出窗口）
  });

  it('短消息（有效字符<4）剔除', () => {
    const out = cleaner.clean([msg({ content: '好的' }), msg({ content: '请问如何退款' })]);
    expect(out.map((m) => m.content)).toEqual(['请问如何退款']);
  });
});

describe('QaPairing', () => {
  const pairing = new QaPairing(30 * 60_000, 6);

  it('客户问 + 客服实质回复 → 一条 item', () => {
    const { paired, unpaired } = pairing.pair([
      msg({ content: '请问订单怎么退款', senderType: 'customer', occurredAt: 0 }),
      msg({ content: '您在订单页点击申请退款即可', senderType: 'service', occurredAt: 1000 }),
    ]);
    expect(paired).toHaveLength(1);
    expect(paired[0].question).toBe('请问订单怎么退款');
    expect(paired[0].answer).toContain('申请退款');
    expect(unpaired).toHaveLength(0);
  });

  it('按轮次配对：客户问 + 客服答各成一条', () => {
    const { paired } = pairing.pair([
      msg({ content: '第一个客户的问法', senderType: 'customer', occurredAt: 0 }),
      msg({ content: '第一次客服答复内容', senderType: 'service', occurredAt: 1000 }),
      msg({ content: '客户继续追问的内容', senderType: 'customer', occurredAt: 2000 }),
      msg({ content: '第二次客服最终答复', senderType: 'service', occurredAt: 3000 }),
    ]);
    expect(paired).toHaveLength(2);
    expect(paired[0].question).toBe('第一个客户的问法');
    expect(paired[0].answer).toBe('第一次客服答复内容');
    expect(paired[1].answer).toBe('第二次客服最终答复');
  });

  it('单边消息入未配对池', () => {
    const { paired, unpaired } = pairing.pair([
      msg({ content: '只有客户说话没有客服回复', senderType: 'customer', occurredAt: 0 }),
    ]);
    expect(paired).toHaveLength(0);
    expect(unpaired).toHaveLength(1);
  });

  it('超 30 分钟间隔切分窗口', () => {
    const { paired } = pairing.pair([
      msg({ content: '窗口一的客户问题', senderType: 'customer', occurredAt: 0 }),
      msg({ content: '窗口一的客服回复', senderType: 'service', occurredAt: 1000 }),
      msg({ content: '窗口二的客户问题', senderType: 'customer', occurredAt: 40 * 60_000 }),
      msg({ content: '窗口二的客服回复', senderType: 'service', occurredAt: 40 * 60_000 + 1000 }),
    ]);
    expect(paired).toHaveLength(2);
  });
});

describe('sniffShape', () => {
  it('企微存档 JSON', async () => {
    const buf = Buffer.from(JSON.stringify([{ sender: '客户A', content: '问题内容', time: 1 }]));
    expect(await sniffShape(buf, 'application/json')).toBe('wecom-archive');
  });

  it('三列表 CSV', async () => {
    const buf = Buffer.from('时间,说话方,内容\n2026-01-01,客户,问题内容', 'utf8');
    expect(await sniffShape(buf, 'text/csv')).toBe('conversation-table');
  });

  it('直接成对 JSON', async () => {
    const buf = Buffer.from(JSON.stringify([{ question: 'q', answer: 'a' }]));
    expect(await sniffShape(buf, 'application/json')).toBe('qa-pairs');
  });

  it('未识别 JSON 抛错', async () => {
    const buf = Buffer.from(JSON.stringify({ foo: 1 }));
    await expect(sniffShape(buf, 'application/json')).rejects.toBeInstanceOf(
      UnrecognizedShapeError,
    );
  });
});

describe('ImportBlacklist', () => {
  it('命中关键词', () => {
    const bl = new ImportBlacklist(['价格', '竞品']);
    expect(bl.matches('这个价格是多少')).toBe(true);
    expect(bl.matches('如何使用')).toBe(false);
  });
});
