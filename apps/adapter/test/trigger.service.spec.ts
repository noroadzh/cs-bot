/**
 * TriggerService 单元测试
 * 覆盖：@mention / 关键词前缀 / 自发言 / 非文本未@ / 未匹配 + 关键词热重载
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const KEYWORDS_FILE = join(tmpdir(), 'csbot-test-keywords.yml');
const BOT_USER_ID = 'bot-user-id';

const writeKeywords = (words: string[]): void => {
  writeFileSync(KEYWORDS_FILE, `keywords:\n${words.map((w) => `  - ${w}`).join('\n')}\n`, 'utf8');
};

const makeMsg = (overrides: Record<string, unknown> = {}): any => ({
  ChatId: 'chat-1',
  FromUserName: 'user-A',
  MsgType: 'text',
  Content: '你好',
  text: '你好',
  mentioned: false,
  MsgId: 'm1',
  ...overrides,
});

describe('TriggerService', () => {
  beforeAll(() => {
    writeKeywords(['退货', '发票', '保修']);
    setConfig({ KEYWORDS_FILE, WECHAT_BOT_USER_ID: BOT_USER_ID });
  });

  afterAll(() => {
    resetConfig();
    if (existsSync(KEYWORDS_FILE)) unlinkSync(KEYWORDS_FILE);
  });

  it('2.2.a @mention：triggered=true, reason=mention', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ mentioned: true, text: '随便说什么' }));
    expect(r).toEqual({ triggered: true, reason: 'mention' });
  });

  it('2.2.b 关键词前缀命中：triggered=true, reason=keyword', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    expect(svc.evaluate(makeMsg({ text: '退货政策是什么' }))).toEqual({ triggered: true, reason: 'keyword' });
    expect(svc.evaluate(makeMsg({ text: '发票怎么开' }))).toEqual({ triggered: true, reason: 'keyword' });
    expect(svc.evaluate(makeMsg({ text: '保修期内坏了' }))).toEqual({ triggered: true, reason: 'keyword' });
  });

  it('关键词文件损坏 → reload 保留旧 trie 并返回旧数量', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const before = svc.count;
    writeFileSync(KEYWORDS_FILE, '::not yaml:: [', 'utf8');
    expect(svc.reload()).toBe(before);
    writeKeywords(['退货', '发票', '保修']);
    svc.reload();
  });

  it('关键词表含非字符串/空项时过滤', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    writeFileSync(KEYWORDS_FILE, 'keywords:\n  - 42\n  - ""\n  - 退款\n', 'utf8');
    const svc = new TriggerService({} as any);
    expect(svc.count).toBe(1);
    expect(svc.evaluate(makeMsg({ text: '退款' }))).toEqual({ triggered: true, reason: 'keyword' });
    writeKeywords(['退货', '发票', '保修']);
    svc.reload();
  });

  it('无文本消息 → 空文本分支不命中', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    expect(svc.evaluate(makeMsg({ text: undefined, Content: undefined }))).toEqual({ triggered: false, reason: 'no_match' });
  });

  it('2.2.c 自发言（FromUserName === botUserId）：triggered=false, reason=self', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ FromUserName: BOT_USER_ID, mentioned: true }));
    expect(r).toEqual({ triggered: false, reason: 'self' });
  });

  it('2.2.d 非文本且未 @：triggered=false, reason=non_text_no_mention', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ MsgType: 'image', text: '' }));
    expect(r).toEqual({ triggered: false, reason: 'non_text_no_mention' });
  });

  it('2.2.e 非文本但被 @：triggered=true, reason=mention', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ MsgType: 'image', mentioned: true }));
    expect(r).toEqual({ triggered: true, reason: 'mention' });
  });

  it('2.2.f 文本无关键词前缀：triggered=false, reason=no_match', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ text: '天气不错啊' }));
    expect(r).toEqual({ triggered: false, reason: 'no_match' });
  });

  it('2.2.g 关键词不匹配前缀（出现在中间）：no_match', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    const r = svc.evaluate(makeMsg({ text: '我想咨询退货' }));
    expect(r).toEqual({ triggered: false, reason: 'no_match' });
  });

  it('2.2.h count 返回当前关键词数量', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    expect(svc.count).toBe(3);
  });

  it('2.2.i reload 热重载：改文件后 count 更新且新关键词生效', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    expect(svc.count).toBe(3);
    expect(svc.evaluate(makeMsg({ text: '物流到哪了' }))).toEqual({ triggered: false, reason: 'no_match' });

    writeKeywords(['物流', '客服']);
    expect(svc.reload()).toBe(2);
    expect(svc.count).toBe(2);
    expect(svc.evaluate(makeMsg({ text: '物流到哪了' }))).toEqual({ triggered: true, reason: 'keyword' });
    // 旧关键词已失效
    expect(svc.evaluate(makeMsg({ text: '退货政策' }))).toEqual({ triggered: false, reason: 'no_match' });
  });

  it('2.2.j reload 文件损坏/不存在：保留旧关键词数量，evaluate 仍可用', async () => {
    const { TriggerService } = await import('../src/routing/trigger.service.js');
    const svc = new TriggerService({} as any);
    unlinkSync(KEYWORDS_FILE);
    expect(svc.reload()).toBe(2); // 保持上次数量
    expect(svc.evaluate(makeMsg({ text: '物流到哪了' }))).toEqual({ triggered: true, reason: 'keyword' });
  });
});