/**
 * ApprovedQaService 单元测试
 *
 * 覆盖 search 方法的分支：
 * - 空/短问题 → 返回 null，不查数据库
 * - 数据库无结果 → 返回 null
 * - 数据库返回结果 → 返回第一条
 * - 数据库异常 → 返回 null 并记录日志
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

// Mock pg Pool — 每个服务实例拿到独立的 pool mock
jest.unstable_mockModule('pg', () => {
  let _query: jest.MockedFunction<any> = jest.fn() as any;
  let _end: jest.MockedFunction<any> = jest.fn();
  return {
    Pool: jest.fn(() => ({ query: _query, end: _end })),
    _getQuery: () => _query,
    _getEnd: () => _end,
  };
});

describe('ApprovedQaService', () => {
  let service: any;

  beforeAll(() => setConfig());
  afterAll(() => resetConfig());

  beforeEach(async () => {
    setConfig();
    // Import after setConfig so ConfigService.instance is set on the right class
    const { ApprovedQaService } = await import('../src/qa/approved-qa.service.js');
    service = new ApprovedQaService();
  });

  afterEach(async () => {
    try { await service?.onModuleDestroy(); } catch { /* ignore cleanup errors */ }
  });

  describe('search', () => {
    it('空字符串返回 null', async () => {
      const { ApprovedQaService: A } = await import('../src/qa/approved-qa.service.js');
      const s = new A();
      expect(await s.search('')).toBeNull();
      await s.onModuleDestroy();
    });

    it('问题太短（1 字符）返回 null', async () => {
      expect(await service.search('a')).toBeNull();
    });

    it('2 字符及以上正常查询', async () => {
      const { ApprovedQaService: A } = await import('../src/qa/approved-qa.service.js');
      const mockQ = (jest.fn() as any).mockResolvedValue({ rows: [] });
      const mockPool2 = { query: mockQ, end: jest.fn() };
      const s = new A(mockPool2 as any);
      const result = await s.search('退款');
      expect(result).toBeNull();
      expect(mockQ).toHaveBeenCalledWith(expect.stringContaining('SELECT'), ['%退款%']);
      await s.onModuleDestroy();
    });

    it('数据库返回空结果 → 返回 null', async () => {
      const { ApprovedQaService: A } = await import('../src/qa/approved-qa.service.js');
      const mockQ = (jest.fn() as any).mockResolvedValue({ rows: [] });
      const mockPool2 = { query: mockQ, end: jest.fn() };
      const s = new A(mockPool2 as any);
      const result = await s.search('如何绑定');
      expect(result).toBeNull();
      await s.onModuleDestroy();
    });

    it('数据库返回结果 → 返回第一条', async () => {
      const { ApprovedQaService: A } = await import('../src/qa/approved-qa.service.js');
      const mockRow = {
        id: 'qa-123',
        question: '如何绑定license',
        answer: '在管理后台绑定',
        sourceJobId: 'job-1',
        sourceItemId: 'item-1',
        createdAt: new Date('2024-01-01'),
      };
      const mockQ = (jest.fn() as any).mockResolvedValue({ rows: [mockRow] });
      const mockPool2 = { query: mockQ, end: jest.fn() };
      const s = new A(mockPool2 as any);
      const result = await s.search('如何绑定');
      expect(result).toEqual(mockRow);
      await s.onModuleDestroy();
    });

    it('数据库异常 → 返回 null', async () => {
      const { ApprovedQaService: A } = await import('../src/qa/approved-qa.service.js');
      const mockQ = (jest.fn() as any).mockRejectedValue(new Error('DB connection failed'));
      const mockPool2 = { query: mockQ, end: jest.fn() };
      const s = new A(mockPool2 as any);
      const result = await s.search('测试问题');
      expect(result).toBeNull();
      await s.onModuleDestroy();
    });
  });
});