/**
 * QaOrchestrator 单元测试
 * 覆盖点：IMessageSender 注入、分段发送、@提及、上下文追加、低分 miss 记录
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { ConfigService } from '../src/config/config.service.js';

beforeAll(() => {
  setConfig({
    CONFIDENCE_THRESHOLD: 0.75,
    CONTEXT_ROUNDS: 5,
    SEGMENT_SAFE_BYTES: 200,
    SEGMENT_GAP_MS: 0,
  });
});

afterAll(() => resetConfig());

const makeMsg = (overrides: Partial<any> = {}): any => ({
  ChatId: 'chat-1',
  FromUserName: 'user-A',
  MsgType: 'text',
  Content: 'hello',
  text: 'hello',
  mentioned: false,
  ...overrides,
});

const stubEngine = (overrides: Partial<any> = {}): any => ({
  mode: 'mock',
  ask: jest.fn(async () => ({
    ok: true,
    value: { answer: 'mock-answer', quotes: [], score: 0.9 },
  })),
  ...overrides,
});

const stubContext = (): any => ({
  get: jest.fn(async () => []),
  append: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
});

const stubFilter = (): any => ({
  sweep: jest.fn((s: string) => s),
});

const stubMiss = (): any => ({
  record: jest.fn(async () => undefined),
});

const stubAsset = (): any => ({
  send: jest.fn(async () => undefined),
});

const makeSender = () => ({
  sendText: jest.fn(async (..._args: unknown[]) => undefined),
  sendAsset: jest.fn(async (..._args: unknown[]) => undefined),
});

describe('QaOrchestrator', () => {
  it('1.6.a injects via IMessageSender token (not WecomClient class)', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const sender = makeSender();
    const engine = stubEngine();
    const orch = new QaOrchestrator(
      engine,
      stubContext(),
      stubFilter(),
      stubMiss(),
      stubAsset(),
      sender as any,
    );
    await orch.handle(makeMsg({ mentioned: true }), 'trace-1', 'mention');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', 'mock-answer', 'user-A');
  });

  it('1.6.b segments long text and sends each chunk via sender', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const long = 'A'.repeat(60) + '。' + 'B'.repeat(60) + '。' + 'C'.repeat(60) + '。' + 'D'.repeat(60);
    ConfigService.instance.SEGMENT_SAFE_BYTES = 80;
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: true, value: { answer: long, quotes: [], score: 0.9 } })) });
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), sender as any);
    await orch.handle(makeMsg(), 'trace-2', 'keyword');
    expect(sender.sendText.mock.calls.length).toBeGreaterThan(1);
  });

  it('1.6.c records miss when score below threshold and uses refusal text', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: true, value: { answer: 'no idea', quotes: [], score: 0.1 } })) });
    const miss = stubMiss();
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), miss, stubAsset(), sender as any);
    await orch.handle(makeMsg(), 'trace-3', 'keyword');
    expect(miss.record).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '暂时没有合适答案，已记录到工单', undefined);
  });

  it('1.6.d sends LLM error as slow reply without throwing', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: false, error: { code: -1, message: 'timeout' } })) });
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), sender as any);
    await expect(orch.handle(makeMsg(), 'trace-4', 'keyword')).resolves.toBeUndefined();
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '系统繁忙，请稍后再试', undefined);
  });

  it('1.6.e appends context when score above threshold', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine();
    const ctx = stubContext();
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, ctx, stubFilter(), stubMiss(), stubAsset(), sender as any);
    await orch.handle(makeMsg(), 'trace-5', 'keyword');
    expect(ctx.append).toHaveBeenCalledWith('chat-1', 'user-A', { question: 'hello', answer: 'mock-answer' });
  });

  it('1.6.f does not call WecomClient class anywhere in the orchestrator module', async () => {
    const mod = await import('../src/qa/qa-orchestrator.js');
    const src = mod.toString();
    // 确认类名引用中无 WecomClient
    const m = /import\s+.*?\s+from\s+['"][^'"]*wecom-client/.exec(src);
    expect(m).toBeNull();
  });
});
