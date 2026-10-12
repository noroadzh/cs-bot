/**
 * MockQaEngine 单元测试
 * 覆盖：Jaccard 命中/Jaccard 低兜底/默认词表/自定义文件
 */
import { setConfig } from './__setup__/test-helpers.js';

beforeAll(() => setConfig());

describe('MockQaEngine', () => {
  it('命中默认词表：Jaccard 评分 ≥ 0.3 → 返回答案', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(''),
      existsSync: jest.fn().mockReturnValue(false),
    }));
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine();
    const r = await engine.ask({ traceId: 't1', question: '请问退货政策' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.val.answer).toContain('退换货');
      expect(r.val.score).toBeGreaterThan(0);
    }
  });

  it('低分兜底：未匹配 → 返回默认 "未找到" 答案', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(''),
      existsSync: jest.fn().mockReturnValue(false),
    }));
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine();
    const r = await engine.ask({ traceId: 't2', question: 'xyz' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.val.answer).toContain('未找到');
      expect(r.val.score).toBe(0);
    }
  });

  it('加载自定义文件：使用配置中的问答对', async () => {
    const custom = JSON.stringify([
      { question: '色卡', answer: '回答色卡', keywords: ['色', '卡'], score: 0.9 },
    ]);
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(custom),
      existsSync: jest.fn().mockReturnValue(true),
    }));
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine('/tmp/qa.json');
    const r = await engine.ask({ traceId: 't3', question: '色卡问题' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.val.answer).toBe('回答色卡');
  });
});
