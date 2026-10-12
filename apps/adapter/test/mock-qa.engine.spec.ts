/**
 * MockQaEngine 单元测试
 * 覆盖：Jaccard 命中/Jaccard 低兜底/默认词表/自定义文件
 */
import { setConfig } from './__setup__/test-helpers.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

beforeAll(() => setConfig());

describe('MockQaEngine', () => {
  beforeEach(() => setConfig());

  it('命中默认词表：Jaccard 评分 ≥ 0.3 → 返回答案', async () => {
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine(); // file 不存在 → defaults
    const r = await engine.ask({ traceId: 't1', question: '请问退货政策' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.answer).toContain('退换货');
      expect(r.value.score).toBeGreaterThan(0);
    }
  });

  it('低分兜底：未匹配 → 返回默认 "未找到" 答案', async () => {
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine();
    const r = await engine.ask({ traceId: 't2', question: 'xyz' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.answer).toContain('未找到');
      expect(r.value.score).toBe(0);
    }
  });

  it('加载自定义文件：使用配置中的问答对', async () => {
    // 真实写文件 + 真实路径，不用 fs mock（避免污染其他模块）
    const customFile = join(tmpdir(), 'csbot-test-custom-qa.json');
    const custom = JSON.stringify([
      { question: '色卡', answer: '回答色卡', keywords: ['色', '卡'], score: 0.9 },
    ]);
    writeFileSync(customFile, custom, 'utf8');
    const { MockQaEngine } = await import('../src/qa/mock-qa.engine.js');
    const engine = new MockQaEngine(customFile);
    const r = await engine.ask({ traceId: 't3', question: '色卡问题' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.answer).toBe('回答色卡');
  });
});