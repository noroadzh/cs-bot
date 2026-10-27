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
    expect(out.question).toBe('我的***号]');
    expect(out.text).toBe('请帮***谢谢');
    expect((out.meta as any).reply).toBe('好的***完成');
    expect(out.chatHash).toBe('abc');
  });

  it('手机号/身份证/银行卡/邮箱按模式打码', () => {
    const out = sanitizeLogPayload({
      detail: '手机 13800138000，身份证 110101199001011234，卡 6222021234567890123，邮箱 a@b.com',
    });
    const s = String(out.detail);
    expect(s).toContain('[手机号]');
    expect(s).toContain('[身份证号]');
    expect(s).toContain('[银行卡号]');
    expect(s).toContain('[邮箱]');
    expect(s).not.toContain('13800138000');
    expect(s).not.toContain('110101199001011234');
    expect(s).not.toContain('6222021234567890123');
    expect(s).not.toContain('a@b.com');
  });

  it('不修改入参对象', () => {
    const input = { question: '我的手机号是13800138000' };
    sanitizeLogPayload(input);
    expect(input.question).toBe('我的手机号是13800138000');
  });
});
