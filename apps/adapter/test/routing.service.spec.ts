/**
 * RoutingService 单元测试
 * 覆盖：dedup 命中跳过 / 触发条件未命中跳过 / 限流命中跳过 / 正常路由到 orchestrator
 */
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { setConfig } from './__setup__/test-helpers.js';

/** 5 参注入的 UsageService 替身：只做埋点计数，不参与路由决策，故全文件共用一个 */
const usageMock = { increment: jest.fn() };

beforeAll(() => setConfig());
beforeEach(() => usageMock.increment.mockClear());

const makeMsg = (overrides: Record<string, unknown> = {}): any => ({
  MsgId: 'msg-001',
  ChatId: 'chat-1',
  FromUserName: 'user-A',
  MsgType: 'text',
  Content: 'hello',
  text: 'hello',
  mentioned: true,
  ...overrides,
});

beforeAll(() => setConfig());

describe('RoutingService', () => {
  it('3.3.a dedup 命中：dispatch 直接返回，不触发 orchestrator', async () => {
    const dedupMock = { isDuplicate: jest.fn().mockResolvedValue(true) };
    const triggerMock = { evaluate: jest.fn() };
    const rateMock = { check: jest.fn() };
    const orchMock = { handle: jest.fn() };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg(), 'trace-1');

    expect(dedupMock.isDuplicate).toHaveBeenCalledWith('msg-001');
    expect(triggerMock.evaluate).not.toHaveBeenCalled();
    expect(orchMock.handle).not.toHaveBeenCalled();
  });

  it('3.3.b 触发条件未命中：evaluate 返回 false，直接返回，不路由', async () => {
    const dedupMock = { isDuplicate: jest.fn().mockResolvedValue(false) };
    const triggerMock = { evaluate: jest.fn().mockReturnValue({ triggered: false, reason: 'no_match' }) };
    const rateMock = { check: jest.fn() };
    const orchMock = { handle: jest.fn() };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg(), 'trace-2');

    expect(triggerMock.evaluate).toHaveBeenCalled();
    expect(rateMock.check).not.toHaveBeenCalled();
    expect(orchMock.handle).not.toHaveBeenCalled();
  });

  it('3.3.c 限流命中：check 返回 allowed=false，直接返回，不路由', async () => {
    const dedupMock = { isDuplicate: jest.fn().mockResolvedValue(false) };
    const triggerMock = { evaluate: jest.fn().mockReturnValue({ triggered: true, reason: 'mention' }) };
    const rateMock = { check: jest.fn().mockResolvedValue({ allowed: false, scope: 'group' }) };
    const orchMock = { handle: jest.fn() };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg(), 'trace-3');

    expect(rateMock.check).toHaveBeenCalledWith('chat-1', 'user-A');
    expect(orchMock.handle).not.toHaveBeenCalled();
  });

  it('3.3.d 全链路通过：正常路由到 orchestrator.handle', async () => {
    const dedupMock = { isDuplicate: jest.fn().mockResolvedValue(false) };
    const triggerMock = { evaluate: jest.fn().mockReturnValue({ triggered: true, reason: 'keyword' }) };
    const rateMock = { check: jest.fn().mockResolvedValue({ allowed: true }) };
    const orchMock = { handle: jest.fn().mockResolvedValue(undefined) };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg(), 'trace-4');

    expect(orchMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ MsgId: 'msg-001' }),
      'trace-4',
      'keyword',
    );
  });

  it('3.3.e 无 MsgId：dedup.isDuplicate 不被调用', async () => {
    const dedupMock = { isDuplicate: jest.fn() };
    const triggerMock = { evaluate: jest.fn().mockReturnValue({ triggered: false, reason: 'no_match' }) };
    const rateMock = { check: jest.fn() };
    const orchMock = { handle: jest.fn() };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg({ MsgId: undefined }), 'trace-5');

    expect(dedupMock.isDuplicate).not.toHaveBeenCalled();
  });

  it('3.3.f 无 ChatId：rateLimiter.check 不被调用', async () => {
    const dedupMock = { isDuplicate: jest.fn().mockResolvedValue(false) };
    const triggerMock = { evaluate: jest.fn().mockReturnValue({ triggered: true, reason: 'mention' }) };
    const rateMock = { check: jest.fn() };
    const orchMock = { handle: jest.fn() };

    jest.mock('../src/routing/dedup.service.js', () => ({ DedupService: jest.fn().mockImplementation(() => dedupMock) }));
    jest.mock('../src/routing/trigger.service.js', () => ({ TriggerService: jest.fn().mockImplementation(() => triggerMock) }));
    jest.mock('../src/routing/rate-limiter.service.js', () => ({ RateLimiterService: jest.fn().mockImplementation(() => rateMock) }));
    jest.mock('../src/qa/qa-orchestrator.js', () => ({ QaOrchestrator: jest.fn().mockImplementation(() => orchMock) }));

    const { RoutingService } = await import('../src/routing/routing.service.js');
    const svc = new RoutingService(
      triggerMock as any,
      dedupMock as any,
      rateMock as any,
      orchMock as any,
      usageMock as any,
    );

    await svc.dispatch(makeMsg({ ChatId: undefined }), 'trace-6');

    expect(rateMock.check).not.toHaveBeenCalled();
    expect(orchMock.handle).toHaveBeenCalled();
  });
});