/**
 * 管道开销预算（扣除注入的模型等待）
 * 文本：0.2 路由 + 0.1 上下文 + 0.4 编排 + 1.3 发送余量 = 2s
 * 图片：识别路径开销 < 12s
 * 真实 DeepSeek / VL 不在默认单测里跑。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { MediaRecognizeService } from '../src/media/media-recognize.service.js';

const INJECTED_MS = 40;

beforeAll(() => {
  setConfig({
    CONFIDENCE_THRESHOLD: 0.75,
    CONTEXT_ROUNDS: 5,
    SEGMENT_SAFE_BYTES: 2000,
    SEGMENT_GAP_MS: 0,
    USE_MOCK_LLM: true,
  });
});

afterAll(() => resetConfig());

describe('pipeline overhead budget', () => {
  it('文本编排扣除注入等待后低于 2 秒', async () => {
    const { QaOrchestrator } = await import('../src/qa/qa-orchestrator.js');
    const sender = { sendText: jest.fn(async () => undefined), sendAsset: jest.fn(async () => undefined) };
    const engine = {
      mode: 'mock',
      ask: jest.fn(async () => {
        await new Promise((r) => setTimeout(r, INJECTED_MS));
        return { ok: true, value: { answer: 'mock-answer', quotes: [], score: 0.9 } };
      }),
    };
    const orch = new QaOrchestrator(
      engine as any,
      { get: jest.fn(async () => []), append: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) } as any,
      { sweep: jest.fn((s: string) => s) } as any,
      { record: jest.fn(async () => undefined) } as any,
      { send: jest.fn(async () => undefined) } as any,
      { resolve: jest.fn(() => []) } as any,
      { increment: jest.fn() } as any,
      sender as any,
    );
    const started = Date.now();
    await orch.handle({
      ChatId: 'chat-1',
      FromUserName: 'user-A',
      MsgType: 'text',
      Content: '如何退款',
      text: '如何退款',
      mentioned: true,
    } as any, 'trace-budget', 'mention');
    const overhead = Date.now() - started - INJECTED_MS;
    expect(sender.sendText).toHaveBeenCalled();
    expect(overhead).toBeLessThan(2000);
  });

  it('图片识别扣除注入等待后低于 12 秒', async () => {
    const svc = new MediaRecognizeService({} as any);
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const started = Date.now();
    await new Promise((r) => setTimeout(r, INJECTED_MS));
    const text = await svc.recognizeImage(buf, 'image/jpeg');
    const overhead = Date.now() - started - INJECTED_MS;
    expect(text.length).toBeGreaterThan(0);
    expect(overhead).toBeLessThan(12_000);
  });
});
