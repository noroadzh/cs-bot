/**
 * FastGPTQaEngine 单元测试
 *
 * 对应 src/qa/fastgpt-qa.engine.ts 的分支：
 * - 正常响应走 choices[0].message.content（OpenAI 兼容格式）
 * - 无 choices 时降级读 data[0].content（FastGPT 原生格式）
 * - data[0].score 存在时透传，不存在时用默认 0.8
 * - req.history 缺省 → 不写入 history 消息
 * - req.datasetIds 缺省 → 回落到 config.FASTGPT_DATASET_IDS 单元素数组
 * - req.datasetIds 缺省且 config 无 DATASET_IDS → 空数组
 * - axios 抛错 → 返回 Err(LLM_TIMEOUT)，不向上抛
 *
 * 策略：jest.mock('axios') 拦截 create() 返回带 post 的假实例。
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ErrCode, type AskReq, type AskResult } from '@cs-bot/shared';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const post = jest.fn<(url: string, body: any) => Promise<any>>();

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({ post: (...args: any[]) => post(...(args as [string, any])) })),
  },
}));

/** 构造一个最小合法 AskReq */
const req = (over: Partial<AskReq> = {}): AskReq => ({
  traceId: 'trace-fastgpt-1',
  question: 'Q',
  ...over,
});

/** 断言成功并返回 value（对判别联合做类型收窄） */
function expectOk(res: AskResult) {
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error('期望 ok=true，实际为 Err');
  return res.value;
}

beforeEach(() => {
  post.mockReset();
  setConfig({
    FASTGPT_BASE_URL: 'https://fastgpt.example.com',
    FASTGPT_API_KEY: 'k',
    FASTGPT_DATASET_IDS: 'ds-1',
  });
});

afterEach(() => resetConfig());

async function buildEngine() {
  const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
  const { ConfigService } = await import('../src/config/config.service.js');
  return new FastGPTQaEngine(ConfigService as any);
}

describe('FastGPTQaEngine', () => {
  it('正常路径：OpenAI 兼容 choices 格式 → 返回 answer + 默认 score 0.8', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: '这是答案' } }] } });
    const engine = await buildEngine();

    const value = expectOk(await engine.ask(req({ question: '怎么退款？' })));

    expect(value).toEqual({ answer: '这是答案', quotes: [], score: 0.8, source: 'primary' });
  });

  it('降级路径：无 choices → 读 data[0].content 且透传 data[0].score', async () => {
    post.mockResolvedValueOnce({ data: { data: [{ content: '原生格式答案', score: 0.93 }] } });
    const engine = await buildEngine();

    const value = expectOk(await engine.ask(req()));

    expect(value).toEqual({ answer: '原生格式答案', quotes: [], score: 0.93, source: 'primary' });
  });

  it('空响应兜底：既无 choices 也无 data → answer 空串 + score 0.8', async () => {
    post.mockResolvedValueOnce({ data: {} });
    const engine = await buildEngine();

    const value = expectOk(await engine.ask(req()));

    expect(value).toEqual({ answer: '', quotes: [], score: 0.8, source: 'primary' });
  });

  it('history 映射为 messages 前缀，question 作为最后一条 user 消息', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req({
      question: '第二个问题',
      history: [
        { role: 'user', content: '第一个问题' },
        { role: 'assistant', content: '第一个回答' },
      ],
    }));

    const [, body] = post.mock.calls[0];
    expect(body.messages).toEqual([
      { role: 'user', content: '第一个问题' },
      { role: 'assistant', content: '第一个回答' },
      { role: 'user', content: '第二个问题' },
    ]);
  });

  it('history 缺省 → messages 只有当前 question 一条', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req({ question: '只有一个问题' }));

    const [, body] = post.mock.calls[0];
    expect(body.messages).toEqual([{ role: 'user', content: '只有一个问题' }]);
  });

  it('datasetIds 缺省 → 回落到 config.FASTGPT_DATASET_IDS 组成单元素数组', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req());

    const [, body] = post.mock.calls[0];
    expect(body.datasetIds).toEqual(['ds-1']);
  });

  it('datasetIds 显式传入 → 优先使用入参，不读 config', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req({ datasetIds: ['ds-explicit'] }));

    const [, body] = post.mock.calls[0];
    expect(body.datasetIds).toEqual(['ds-explicit']);
  });

  it('datasetIds 缺省且 config 为空串 → 空数组（不产生 [undefined]）', async () => {
    setConfig({ FASTGPT_DATASET_IDS: '' });
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req());

    const [, body] = post.mock.calls[0];
    expect(body.datasetIds).toEqual([]);
  });

  it('异常路径：axios 抛网络错 → 返回 Err(LLM_TIMEOUT) 而非向上抛', async () => {
    // config 默认配了 LLM_FALLBACK_*，primary 失败后 engine 会再打一次 fallback；
    // 两次都要 reject，否则第二次 post 拿到 undefined，错误信息就不是 ECONNREFUSED 了。
    post.mockRejectedValue(new Error('ECONNREFUSED')); // primary retry + fallback retry
    const engine = await buildEngine();

    const res = await engine.ask(req());

    expect(res.ok).toBe(false);
    const err = res as unknown as { error: { code: number; message: string } };
    expect(err.error.code).toBe(ErrCode.LLM_TIMEOUT);
    expect(err.error.message).toBe('ECONNREFUSED');
  });

  it('主通道重试一次：首次失败后重试成功，不再走 fallback', async () => {
    post
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '重试成功' } }] } });
    const engine = await buildEngine();

    const value = expectOk(await engine.ask(req()));

    expect(value.answer).toBe('重试成功');
    expect(value.source).toBe('primary');
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('解析 responseData[].quoteList：score 取最高分并带 source', async () => {
    post.mockResolvedValueOnce({
      data: {
        choices: [{ message: { content: '带引用答案' } }],
        responseData: [
          { quoteList: [{ id: 'q1', content: 'a', score: 0.7, datasetName: '财务制度.pdf' }] },
          { quoteList: [{ id: 'q2', content: 'b', score: 0.92, source: '报销流程.docx' }] },
        ],
      },
    });
    const engine = await buildEngine();
    const value = expectOk(await engine.ask(req()));
    expect(value.answer).toBe('带引用答案');
    expect(value.score).toBeCloseTo(0.92);
    expect(value.quotes?.map((q) => [q.score, q.source])).toEqual([[0.92, '报销流程.docx'], [0.7, '财务制度.pdf']]);
  });

  it('请求参数：URL 为 /api/v1/chat/completions，model 固定 fastgpt', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const engine = await buildEngine();

    await engine.ask(req());

    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/api/v1/chat/completions');
    expect(body.model).toBe('fastgpt');
  });

  // --- approved_qa fallback 测试 ---
  it('primary 返回低分 → fallback 到 approved_qa 命中', async () => {
    // mock primary 返回低分
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: 'low' } }], data: [{ score: 0.3 }] } });
    // mock approved_qa 命中
    const mockApprovedQa = {
      search: jest.fn<() => Promise<{ question: string; answer: string } | null>>().mockResolvedValue({ question: '怎么退款', answer: '30天内可退' })
    };
    const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
    const { ConfigService } = await import('../src/config/config.service.js');
    const engine = new FastGPTQaEngine(ConfigService as any, mockApprovedQa as any);

    const value = expectOk(await engine.ask(req({ question: '退款政策' })));

    expect(value.answer).toBe('30天内可退');
    expect(value.source).toBe('approved');
    expect(value.score).toBe(1.0);
  });

  it('primary 失败 + fallback 失败 → fallback 到 approved_qa', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED')); // primary retry + fallback retry
    const mockApprovedQa = {
      search: jest.fn<() => Promise<{ question: string; answer: string } | null>>().mockResolvedValue({ question: '退款', answer: '请联系客服' })
    };
    const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
    const { ConfigService } = await import('../src/config/config.service.js');
    const engine = new FastGPTQaEngine(ConfigService as any, mockApprovedQa as any);

    const value = expectOk(await engine.ask(req({ question: '退款' })));

    expect(value.answer).toBe('请联系客服');
    expect(value.source).toBe('approved');
  });

  it('primary 返回高分 → 仍走 approved_qa（但 approved_qa 无结果时才用 primary）', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: '高分答案' } }], data: [{ score: 0.9 }] } });
    const mockApprovedQa = {
      search: jest.fn<(question: string) => Promise<{ question: string; answer: string } | null>>().mockResolvedValue(null)
    };
    const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
    const { ConfigService } = await import('../src/config/config.service.js');
    const engine = new FastGPTQaEngine(ConfigService as any, mockApprovedQa as any);

    const value = expectOk(await engine.ask(req({ question: '测试' })));

    expect(mockApprovedQa.search).toHaveBeenCalledWith('测试');
    expect(value.source).toBe('primary');
  });

  it('所有 LLM 和 approved_qa 都无结果 → 返回 primary 结果（即使是低分）', async () => {
    post.mockResolvedValueOnce({ data: { choices: [{ message: { content: '空答案' } }], data: [{ score: 0.2 }] } });
    const mockApprovedQa = {
      search: jest.fn<() => Promise<{ question: string; answer: string } | null>>().mockResolvedValue(null)
    };
    const { FastGPTQaEngine } = await import('../src/qa/fastgpt-qa.engine.js');
    const { ConfigService } = await import('../src/config/config.service.js');
    const engine = new FastGPTQaEngine(ConfigService as any, mockApprovedQa as any);

    const value = expectOk(await engine.ask(req({ question: '测试' })));

    expect(value.answer).toBe('空答案');
    expect(value.source).toBe('primary');
  });
});