/**
 * SensitiveFilterService 单元测试
 * 覆盖：命中替换/未命中/空词表/多词全部替换/不存在文件
 */
import { setConfig } from './__setup__/test-helpers.js';

beforeAll(() => setConfig());

// 重置 jest mocks 状态
beforeEach(() => {
  jest.resetModules();
});

describe('SensitiveFilterService', () => {
  it('命中敏感词：替换为 [内容已过滤]', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue('敏感词\n违禁品\n'),
      existsSync: jest.fn().mockReturnValue(true),
      watch: jest.fn().mockReturnValue({}),
    }));
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    expect(svc.sweep('这是敏感词')).toBe('这是[内容已过滤]');
  });

  it('无敏感词：原文返回', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue('敏感词\n违禁品\n'),
      existsSync: jest.fn().mockReturnValue(true),
      watch: jest.fn().mockReturnValue({}),
    }));
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    expect(svc.sweep('今天天气很好')).toBe('今天天气很好');
  });

  it('空词表文件：原文返回', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(''),
      existsSync: jest.fn().mockReturnValue(true),
      watch: jest.fn().mockReturnValue({}),
    }));
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    expect(svc.sweep('随便说点啥')).toBe('随便说点啥');
  });

  it('多词命中：全部替换', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue('敏感词\n违禁品\n'),
      existsSync: jest.fn().mockReturnValue(true),
      watch: jest.fn().mockReturnValue({}),
    }));
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    expect(svc.sweep('敏感词和违禁品')).toBe('[内容已过滤]和[内容已过滤]');
  });

  it('文件不存在：原文返回', async () => {
    jest.doMock('fs', () => ({
      readFileSync: jest.fn().mockReturnValue(''),
      existsSync: jest.fn().mockReturnValue(false),
      watch: jest.fn().mockReturnValue({}),
    }));
    const { SensitiveFilterService } = await import('../src/filter/sensitive-filter.service.js');
    const svc = new SensitiveFilterService({} as any);
    svc.onModuleInit();
    expect(svc.sweep('一切正常')).toBe('一切正常');
  });
});
