/**
 * 提问归一化与输入守卫
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  normalizeQuestion,
  isUnusableQuestion,
  loadTriggerPrefixes,
  resetPrefixCache,
} from '../src/qa/question-normalizer.js';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'csbot-q-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('normalizeQuestion', () => {
  it('剥离 @机器人 与触发词前缀', () => {
    expect(normalizeQuestion('@机器人 客服：怎么开发票', ['客服：'])).toBe('怎么开发票');
  });

  it('无前缀时仅剥离 mention 并压缩空白', () => {
    expect(normalizeQuestion('  @bot   你好   世界 ', [])).toBe('你好 世界');
  });

  it('长前缀优先匹配', () => {
    expect(normalizeQuestion('请问：客服：退款', ['客服：', '请问：'])).toBe('客服：退款');
  });
});

describe('isUnusableQuestion', () => {
  it('空/纯标点/超长 → true', () => {
    expect(isUnusableQuestion('')).toBe(true);
    expect(isUnusableQuestion('？！。。。')).toBe(true);
    expect(isUnusableQuestion('问'.repeat(501))).toBe(true);
  });
  it('正常问题 → false', () => {
    expect(isUnusableQuestion('怎么退款')).toBe(false);
    expect(isUnusableQuestion('问'.repeat(500))).toBe(false);
  });
});

describe('loadTriggerPrefixes', () => {
  it('读取 keywords.yml 并按 mtime 缓存', async () => {
    const f = join(dir, 'kw.yml');
    await writeFile(f, 'keywords:\n  - "客服："\n  - "请问："\n', 'utf8');
    resetPrefixCache();
    expect(loadTriggerPrefixes(f)).toEqual(['客服：', '请问：']);
    await writeFile(f, 'keywords:\n  - "客服："\n', 'utf8');
    // 同一 mtime 精度下可能复用缓存；明确 reset 后验证新内容
    resetPrefixCache();
    expect(loadTriggerPrefixes(f)).toEqual(['客服：']);
  });
  it('文件不存在 → 空数组', () => {
    expect(loadTriggerPrefixes(join(dir, 'missing.yml'))).toEqual([]);
  });
  it('keywords 非数组/解析失败 → 空数组', async () => {
    const f = join(dir, 'bad.yml');
    await writeFile(f, 'keywords: not-a-list\n', 'utf8');
    resetPrefixCache();
    expect(loadTriggerPrefixes(f)).toEqual([]);
    expect(loadTriggerPrefixes(dir)).toEqual([]); // 目录 → 读失败分支
  });
});
