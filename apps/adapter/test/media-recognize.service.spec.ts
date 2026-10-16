/**
 * parseMimeType 单元测试
 *
 * 覆盖：
 *   - 标准 Content-Type（含 charset / boundary）
 *   - 大小写兼容
 *   - 头缺失 / 解析失败 → null
 *   - 防御性输入（null / undefined / 非 string / 数组）
 */
import { describe, it, expect } from '@jest/globals';
import { parseMimeType } from '../src/media/media-recognize.service.js';

describe('parseMimeType', () => {
  it('提取 image/png', () => {
    expect(parseMimeType('image/png')).toBe('image/png');
  });

  it('提取 image/jpeg 并丢弃 charset', () => {
    expect(parseMimeType('image/jpeg; charset=utf-8')).toBe('image/jpeg');
  });

  it('提取 multipart 并丢弃 boundary', () => {
    expect(parseMimeType('multipart/form-data; boundary=----abc123')).toBe('multipart/form-data');
  });

  it('大小写归一为小写', () => {
    expect(parseMimeType('IMAGE/PNG')).toBe('image/png');
  });

  it('去掉首尾空白', () => {
    expect(parseMimeType('  image/webp  ')).toBe('image/webp');
  });

  it('null / undefined / 空串 → null', () => {
    expect(parseMimeType(null)).toBeNull();
    expect(parseMimeType(undefined)).toBeNull();
    expect(parseMimeType('')).toBeNull();
    expect(parseMimeType('   ')).toBeNull();
  });

  it('数组形态：取首个元素', () => {
    expect(parseMimeType(['image/gif', 'image/png'])).toBe('image/gif');
  });

  it('数组首个为非 string / 空 → null', () => {
    expect(parseMimeType([null, 'image/png'])).toBeNull();
    expect(parseMimeType(['', 'image/png'])).toBeNull();
  });

  it('非 string 输入 → null', () => {
    expect(parseMimeType(42 as unknown)).toBeNull();
    expect(parseMimeType({} as unknown)).toBeNull();
  });
});
