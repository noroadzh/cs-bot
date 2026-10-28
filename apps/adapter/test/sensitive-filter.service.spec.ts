/**
 * SensitiveFilterService 单元测试
 * 覆盖：命中替换/未命中/空词表/多词全部替换/不存在文件
 */
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { setConfig } from './__setup__/test-helpers.js';

const FILE = '/tmp/cs-bot-test-sensitive-words.txt';

beforeAll(() => {
  // 覆盖 SENSITIVE_WORDS_FILE 指向临时测试文件
  setConfig({ SENSITIVE_WORDS_FILE: FILE });
});

describe('SensitiveFilterService', () => {
  afterEach(() => {
    if (existsSync(FILE)) unlinkSync(FILE);
  });

  it('命中敏感词：替换为 [内容已过滤]', async () => {
    mkdirSync('/tmp', { recursive: true });
    writeFileSync(FILE, '敏感词\n违禁品\n');
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    try {
      expect(svc.sweep('这是敏感词')).toBe('抱歉，该内容不便回复，请联系人工客服。');
    } finally {
      svc.onModuleDestroy();
    }
  });

  it('无敏感词：原文返回', async () => {
    writeFileSync(FILE, '敏感词\n违禁品\n');
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    try {
      expect(svc.sweep('今天天气很好')).toBe('今天天气很好');
    } finally {
      svc.onModuleDestroy();
    }
  });

  it('空词表文件：原文返回', async () => {
    writeFileSync(FILE, '');
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    try {
      expect(svc.sweep('随便说点啥')).toBe('随便说点啥');
    } finally {
      svc.onModuleDestroy();
    }
  });

  it('多词命中：全部替换', async () => {
    writeFileSync(FILE, '敏感词\n违禁品\n');
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    try {
      expect(svc.sweep('敏感词和违禁品')).toBe('抱歉，该内容不便回复，请联系人工客服。');
    } finally {
      svc.onModuleDestroy();
    }
  });

  it('文件不存在：原文返回', async () => {
    if (existsSync(FILE)) unlinkSync(FILE);
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    try {
      expect(svc.sweep('一切正常')).toBe('一切正常');
    } finally {
      svc.onModuleDestroy();
    }
  });
});
