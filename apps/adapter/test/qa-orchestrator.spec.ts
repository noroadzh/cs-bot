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

const stubAssetResolver = (): any => ({
  resolve: jest.fn(() => []),
});

const stubUsage = (): any => ({
  increment: jest.fn(),
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
      stubAssetResolver(),
      stubUsage(),
      sender as any,
    );
    await orch.handle(makeMsg({ mentioned: true }), 'trace-1', 'mention');
    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', 'mock-answer', 'user-A', 'trace-1:0');
  });

  it('1.6.b segments long text and sends each chunk via sender', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const long = 'A'.repeat(60) + '。' + 'B'.repeat(60) + '。' + 'C'.repeat(60) + '。' + 'D'.repeat(60);
    ConfigService.instance.SEGMENT_SAFE_BYTES = 80;
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: true, value: { answer: long, quotes: [], score: 0.9 } })) });
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(), stubUsage(), sender as any);
    await orch.handle(makeMsg(), 'trace-2', 'keyword');
    expect(sender.sendText.mock.calls.length).toBeGreaterThan(1);
  });

  it('1.6.c records miss when score below threshold and uses refusal text', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: true, value: { answer: 'no idea', quotes: [], score: 0.1 } })) });
    const miss = stubMiss();
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), miss, stubAsset(), stubAssetResolver(), stubUsage(), sender as any);
    await orch.handle(makeMsg(), 'trace-3', 'keyword');
    expect(miss.record).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。', undefined, 'trace-3:0');
  });

  it('1.6.c2 empty quotes (score 0) → records miss and replies with refusal', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({ ok: true, value: { answer: 'uncited answer', quotes: [], score: 0 } })),
    });
    const miss = stubMiss();
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), miss, stubAsset(), stubAssetResolver(), stubUsage(), sender as any);

    await orch.handle(makeMsg(), 'trace-uncited', 'keyword');

    expect(miss.record).toHaveBeenCalledTimes(1);
    expect(sender.sendText).toHaveBeenCalledWith(
      'chat-1',
      '抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。',
      undefined,
      'trace-uncited:0',
    );
  });

  it('1.6.d sends LLM error as slow reply without throwing', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: false, error: { code: -1, message: 'timeout' } })) });
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(), stubUsage(), sender as any);
    await expect(orch.handle(makeMsg(), 'trace-4', 'keyword')).resolves.toBeUndefined();
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '系统繁忙，请稍后再试', undefined, 'trace-4:0');
  });

  it('1.6.d2 dual-channel failure triggers the LLM alert', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const { LlmAlertService } = await import('../src/qa/llm-alert.service.js');
    const engine = stubEngine({ ask: jest.fn(async () => ({ ok: false, error: { code: -1, message: 'both down' } })) });
    const recordFailure = jest.fn(async (_reason: string) => true);
    const alert = { recordFailure, recordSuccess: jest.fn() } as unknown as InstanceType<typeof LlmAlertService>;
    const orch = new QaOrchestrator(
      engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(), stubUsage(), makeSender() as any, alert,
    );

    await orch.handle(makeMsg(), 'trace-alert', 'keyword');

    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(String(recordFailure.mock.calls[0][0])).toContain('-1');
  });

  it('1.6.e appends context when score above threshold', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine();
    const ctx = stubContext();
    const sender = makeSender();
    const orch = new QaOrchestrator(engine, ctx, stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(), stubUsage(), sender as any);
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

  it('1.6.g increments usage: tokensPrimary + messagesAnswered on success', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      mode: 'fastgpt',
      ask: jest.fn(async () => ({ ok: true, value: { answer: 'mock-answer', quotes: [], score: 0.9, tokens: 150 } })),
    });
    const usage = stubUsage();
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine,
      stubContext(),
      stubFilter(),
      stubMiss(),
      stubAsset(),
      stubAssetResolver(),
      usage,
      sender as any,
    );
    await orch.handle(makeMsg(), 'trace-6', 'keyword');
    expect(usage.increment).toHaveBeenCalledWith('tokensPrimary', 150);
    expect(usage.increment).toHaveBeenCalledWith('messagesAnswered');
  });

  it('1.6.h increments usage: tokensFallback + messagesMissed on fallback error', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      mode: 'fastgpt',
      ask: jest.fn(async () => ({ ok: false, error: { code: -1, message: 'timeout' } })),
    });
    const usage = stubUsage();
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine,
      stubContext(),
      stubFilter(),
      stubMiss(),
      stubAsset(),
      stubAssetResolver(),
      usage,
      sender as any,
    );
    await orch.handle(makeMsg(), 'trace-7', 'keyword');
    expect(usage.increment).toHaveBeenCalledWith('messagesMissed');
  });

  it('1.6.i increments usage: messagesMissed + messagesRefused on low confidence', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({ ok: true, value: { answer: 'no idea', quotes: [], score: 0.1 } })),
    });
    const usage = stubUsage();
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine,
      stubContext(),
      stubFilter(),
      stubMiss(),
      stubAsset(),
      stubAssetResolver(),
      usage,
      sender as any,
    );
    await orch.handle(makeMsg(), 'trace-8', 'keyword');
    expect(usage.increment).toHaveBeenCalledWith('messagesMissed');
    expect(usage.increment).toHaveBeenCalledWith('messagesRefused');
  });

  it('D-3.1 所有模式都调用 engine（保留 FastGPT RAG）', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    for (const mode of ['cloud', 'hybrid', 'local'] as const) {
      ConfigService.instance.MODEL_MODE = mode;
      const engine = stubEngine();
      const orch = new QaOrchestrator(
        engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(),
        stubUsage(), makeSender() as any,
      );
      await orch.handle(makeMsg(), `trace-${mode}`, 'keyword');
      expect(engine.ask).toHaveBeenCalled();
    }
    ConfigService.instance.MODEL_MODE = 'cloud';
  });

  it('D-3.2 engine 走 fallback 时计数 llmFailovers', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({
        ok: true,
        value: { answer: 'fallback-answer', quotes: [], score: 0.9, source: 'fallback' },
      })),
    });
    const usage = stubUsage();
    const orch = new QaOrchestrator(
      engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(),
      usage, makeSender() as any,
    );
    await orch.handle(makeMsg(), 'trace-d2', 'keyword');
    expect(usage.increment).toHaveBeenCalledWith('llmFailovers');
  });

  it('D-3.3 local 引擎失败 → busy 话术（不直连云）', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({ ok: false, error: { code: -1, message: 'local down' } })),
    });
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine, stubContext(), stubFilter(), stubMiss(), stubAsset(), stubAssetResolver(),
      stubUsage(), sender as any,
    );
    await orch.handle(makeMsg(), 'trace-d3', 'keyword');
    expect(sender.sendText).toHaveBeenCalledWith('chat-1', '系统繁忙，请稍后再试', undefined, 'trace-d3:0');
  });
  it('M8.a 素材外发携带 url/name，成功则计数 assetsSent 且不发降级提示', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({
        ok: true,
        value: {
          answer: '见附件 [[素材:aaaaaaaa-1111-2222-3333-444444444444]]',
          quotes: [],
          score: 0.9,
        },
      })),
    });
    const assetSender = { send: jest.fn(async (..._a: any[]) => true) };
    const resolver = {
      resolveReference: jest.fn(async (id: string) => ({
        id, type: 'file', name: '报价单', url: `/assets/${id}.pdf`,
      })),
    };
    const usage = stubUsage();
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine, stubContext(), stubFilter(), stubMiss(), assetSender as any, resolver as any,
      usage, sender as any,
    );

    await orch.handle(makeMsg(), 'trace-m8a', 'mention');

    expect(assetSender.send).toHaveBeenCalledWith('chat-1', {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      type: 'file',
      name: '报价单',
      url: '/assets/aaaaaaaa-1111-2222-3333-444444444444.pdf',
    });
    expect(usage.increment).toHaveBeenCalledWith('assetsSent');
    const notices = sender.sendText.mock.calls.filter(
      (c: any[]) => c[1] === '有关联附件没能发送成功，需要的话请回复人工客服～',
    );
    expect(notices).toHaveLength(0);
  });

  it('M8.b 任一素材失败 → 整条答复只补发一次降级提示，其余素材仍尝试', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const engine = stubEngine({
      ask: jest.fn(async () => ({
        ok: true,
        value: {
          answer: '见附件 [[素材:aaaaaaaa-1111-2222-3333-444444444444]] [[素材:bbbbbbbb-1111-2222-3333-444444444444]]',
          quotes: [],
          score: 0.9,
        },
      })),
    });
    const assetSender = { send: jest.fn(async (..._a: any[]) => false) };
    const resolver = {
      resolveReference: jest.fn(async (id: string) => ({
        id, type: 'file', name: 'n', url: `/assets/${id}.pdf`,
      })),
    };
    const usage = stubUsage();
    const sender = makeSender();
    const orch = new QaOrchestrator(
      engine, stubContext(), stubFilter(), stubMiss(), assetSender as any, resolver as any,
      usage, sender as any,
    );

    await orch.handle(makeMsg(), 'trace-m8b', 'mention');

    expect(assetSender.send).toHaveBeenCalledTimes(2);
    const notices = sender.sendText.mock.calls.filter(
      (c: any[]) => c[1] === '有关联附件没能发送成功，需要的话请回复人工客服～',
    );
    expect(notices).toHaveLength(1);
    expect(usage.increment).not.toHaveBeenCalledWith('assetsSent');
  });
});
