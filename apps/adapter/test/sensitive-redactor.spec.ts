/**
 * SensitiveRedactor 单元测试 — 对应 spec import-review (5 类正则脱敏)
 * 覆盖：每类命中、混合文本、占位符形态、flags 按首次命中顺序、关闭分支。
 */
import { describe, it, expect, afterAll } from '@jest/globals';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SensitiveRedactor } from '../src/import/sensitive-redactor.js';

describe('SensitiveRedactor', () => {
  const r = new SensitiveRedactor();

  it('M10.R.1 手机号 → <PHONE:1>，flags 含 phone', () => {
    const out = r.redact('请联系 13812348888 客服');
    expect(out.text).toBe('请联系 <PHONE:1> 客服');
    expect(out.flags).toContain('phone');
  });

  it('M10.R.2 身份证 18 位（含末位 X）→ <ID:1>，flags 含 id', () => {
    const out = r.redact('证件 11010119900307461X 已核验');
    expect(out.text).toBe('证件 <ID:1> 已核验');
    expect(out.flags).toContain('id');
  });

  it('M10.R.3 银行卡 16 位 → <CARD:1>，flags 含 card', () => {
    const out = r.redact('卡号 6222020200112233 已扣款');
    expect(out.text).toBe('卡号 <CARD:1> 已扣款');
    expect(out.flags).toContain('card');
  });

  it('M10.R.4 邮箱 → <EMAIL:1>，flags 含 email', () => {
    const out = r.redact('邮箱 zhang.san+work@example.com.cn 有效');
    expect(out.text).toBe('邮箱 <EMAIL:1> 有效');
    expect(out.flags).toContain('email');
  });

  it('M10.R.5 URL → <URL:1>，flags 含 url；URL 内 email 不被单独标 email', () => {
    const out = r.redact('详见 https://a.example.com/u/b?email=x@y.com 链接');
    expect(out.text).toBe('详见 <URL:1> 链接');
    expect(out.flags).toContain('url');
    expect(out.flags).not.toContain('email');
  });

  it('M10.R.6 混合文本一次命中多类，flags 去重且按类型独立', () => {
    const out = r.redact('电话13812348888 邮箱a@b.cn 卡号6222020200112233 http://x.cn');
    // 文本中首次出现顺序：phone → email → card → url
    expect(out.flags).toEqual(['phone', 'email', 'card', 'url']);
    // 占位符编号按 type 独立计数，文本顺序即 spec 期望
    expect(out.text).toContain('<PHONE:1>');
    expect(out.text).toContain('<EMAIL:1>');
    expect(out.text).toContain('<CARD:1>');
    expect(out.text).toContain('<URL:1>');
  });

  it('M10.R.7 11 位手机号不被误判为银行卡（前后无数字边界）', () => {
    const out = r.redact('9138123488880');
    // 13 位连续数字 → 不匹配 16-19 位卡号，也不匹配 11 位手机号边界
    expect(out.text).toBe('9138123488880');
    expect(out.flags).toEqual([]);
  });

  it('M10.R.8 纯普通文本原样返回，flags 空', () => {
    const out = r.redact('怎么申请退款？');
    expect(out.text).toBe('怎么申请退款？');
    expect(out.flags).toEqual([]);
  });

  it('M10.R.9 MOCK_REDACTION=true 时不脱敏，flags 空', () => {
    const mock = new SensitiveRedactor({ mockRedaction: true });
    const out = mock.redact('电话13812348888 邮箱a@b.cn');
    expect(out.text).toBe('电话13812348888 邮箱a@b.cn');
    expect(out.flags).toEqual([]);
  });

  it('M10.R.10 同类多次命中 → 占位符编号递增，flags 每类只记一次', () => {
    const out = r.redact('A 13800000001 B 13800000002');
    expect(out.text).toBe('A <PHONE:1> B <PHONE:2>');
    expect(out.flags).toEqual(['phone']);
  });

  it('M10.R.11 详细地址 → <ADDRESS:1>', () => {
    const out = r.redact('寄到北京市朝阳区建国路88号');
    expect(out.text).toContain('<ADDRESS:1>');
    expect(out.flags).toContain('address');
  });

  it('M10.R.12 联系人姓名 → <NAME:1>', () => {
    const out = r.redact('联系人：张三，电话 13800000000');
    expect(out.text).toContain('联系人：<NAME:1>');
    expect(out.flags).toContain('name');
  });

  const nameFile = join(tmpdir(), `csbot-names-${process.pid}.txt`);
  afterAll(() => { try { unlinkSync(nameFile); } catch {} });

  it('M10.R.13 词典姓名无标签也脱敏', () => {
    writeFileSync(nameFile, '张三\n李四\n', 'utf8');
    const dict = new SensitiveRedactor({ nameFile });
    const out = dict.redact('张三说退款要多久');
    expect(out.text).toContain('<NAME:1>');
    expect(out.flags).toContain('name');
  });

  it('M10.R.14 词典缺失时仍按标签脱敏', () => {
    const dict = new SensitiveRedactor({ nameFile: join(tmpdir(), 'csbot-missing-names.txt') });
    const out = dict.redact('联系人：王五');
    expect(out.text).toContain('联系人：<NAME:1>');
  });
});
