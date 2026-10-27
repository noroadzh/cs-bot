/**
 * 路由保护：群白名单、限流提示、去重兜底、信号量、关键词 Trie
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Semaphore } from '../src/common/semaphore.js';
import { KeywordTrie } from '../src/routing/keyword-trie.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const msg = (over: Record<string, unknown> = {}): any => ({
  MsgId: 'm1', ChatId: 'chat-1', FromUserName: 'u1', MsgType: 'text',
  Content: 'hello', text: 'hello', mentioned: true, ...over,
});

async function buildRouting(over: {
  rate?: any; dedup?: any; trigger?: any; orch?: any; sender?: any;
} = {}) {
  const { RoutingService } = await import('../src/routing/routing.service.js');
  const dedup = over.dedup ?? { isDuplicate: jest.fn(async () => false) };
  const trigger = over.trigger ?? { evaluate: jest.fn(() => ({ triggered: true, reason: 'mention' })) };
  const rate = over.rate ?? { check: jest.fn(async () => ({ allowed: true })), shouldHint: jest.fn(async () => true) };
  const orch = over.orch ?? { handle: jest.fn(async () => undefined) };
  const sender = over.sender ?? { sendText: jest.fn(async () => undefined) };
  const usage = { increment: jest.fn() };
  const svc = new RoutingService(trigger, dedup, rate, orch, usage as any, sender as any);
  return { svc, dedup, trigger, rate, orch, sender, usage };
}

beforeEach(() => setConfig());
describe('群白名单', () => {
  it('非白名单群完全静默（不去重/不触发/不落库）', async () => {
    setConfig({ ALLOWED_CHAT_IDS: 'chat-allowed' });
    const { svc, dedup, trigger, orch } = await buildRouting();
    await svc.dispatch(msg({ ChatId: 'chat-other' }), 't1');
    expect(dedup.isDuplicate).not.toHaveBeenCalled();
    expect(trigger.evaluate).not.toHaveBeenCalled();
    expect(orch.handle).not.toHaveBeenCalled();
  });
  it('白名单群正常进入链路', async () => {
    setConfig({ ALLOWED_CHAT_IDS: 'chat-allowed,chat-2' });
    const { svc, orch } = await buildRouting();
    await svc.dispatch(msg({ ChatId: 'chat-allowed' }), 't2');
    expect(orch.handle).toHaveBeenCalled();
  });
});

describe('限流提示', () => {
  it('单人超限 → 立即提示', async () => {
    const rate = { check: jest.fn(async () => ({ allowed: false, scope: 'user' })), shouldHint: jest.fn() };
    const { svc, sender, orch } = await buildRouting({ rate });
    await svc.dispatch(msg(), 't3');
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '提问太频繁，请稍后再试');
    expect(orch.handle).not.toHaveBeenCalled();
  });

  it('群超限 → 5 分钟内只提示一次', async () => {
    const shouldHint = jest.fn<() => Promise<boolean>>();
    shouldHint.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const rate = {
      check: jest.fn(async () => ({ allowed: false, scope: 'group' })),
      shouldHint,
    };
    const { svc, sender } = await buildRouting({ rate });
    await svc.dispatch(msg({ MsgId: 'g1' }), 't4');
    await svc.dispatch(msg({ MsgId: 'g2' }), 't5');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
  });
});

describe('限流提示异常与无 sender', () => {
  it('sender 抛错不冒泡', async () => {
    const rate = { check: jest.fn(async () => ({ allowed: false, scope: 'user' })), shouldHint: jest.fn() };
    const sender = { sendText: jest.fn(async () => { throw new Error('wecom down'); }) };
    const { svc } = await buildRouting({ rate, sender });
    await expect(svc.dispatch(msg(), 't8')).resolves.toBeUndefined();
  });

  it('无 sender 时静默返回', async () => {
    const { RoutingService } = await import('../src/routing/routing.service.js');
    const rate = { check: jest.fn(async () => ({ allowed: false, scope: 'user' })), shouldHint: jest.fn() };
    const svc = new RoutingService(
      { evaluate: () => ({ triggered: true, reason: 'mention' }) } as any,
      { isDuplicate: jest.fn(async () => false) } as any,
      rate as any,
      { handle: jest.fn() } as any,
      { increment: jest.fn() } as any,
    );
    await expect(svc.dispatch(msg(), 't9')).resolves.toBeUndefined();
  });
});

describe('Semaphore', () => {
  it('并发不超过上限且 FIFO 执行', async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all(
      [10, 5, 1].map((ms, i) => sem.run(async () => {
        active += 1; peak = Math.max(peak, active);
        await sleep(ms); order.push(i); active -= 1;
      })),
    );
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2]);
  });
});

describe('KeywordTrie', () => {
  it('前缀命中与最长匹配', () => {
    const t = new KeywordTrie(['客服', '客服：', '请问']);
    expect(t.match('客服：你好')).toBe('客服：');
    expect(t.match('请问退款')).toBe('请问');
    expect(t.match('普通消息')).toBe('');
    expect(t.size).toBe(3);
  });
});

afterAll(() => resetConfig());
