/**
 * 日志正文脱敏：question/answer/content/text/reply 落盘前截断
 */
import { describe, it, expect } from '@jest/globals';
import { sanitizeLogPayload } from '../src/common/logger.js';

describe('sanitizeLogPayload', () => {
  it('顶层与嵌套正文字段均被打码', () => {
    const out = sanitizeLogPayload({
      question: '我的手机号是13800138000',
      text: '请帮我退款谢谢',
      meta: { reply: '好的，已经为您处理完成' },
      chatHash: 'abc',
    });
    expect(out.question).toBe('我的***00');
    expect(out.text).toBe('请帮***谢谢');
    expect((out.meta as any).reply).toBe('好的***完成');
    expect(out.chatHash).toBe('abc');
  });

  it('不修改入参对象', () => {
    const input = { question: '我的手机号是13800138000' };
    sanitizeLogPayload(input);
    expect(input.question).toBe('我的手机号是13800138000');
  });
});
