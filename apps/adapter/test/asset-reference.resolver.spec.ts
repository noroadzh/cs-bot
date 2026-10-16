/**
 * AssetReferenceResolver 单元测试
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { AssetReferenceResolver } from '../src/media/asset-reference.resolver.js';
import type { AssetService } from '../src/media/asset.service.js';
import type { Asset } from '../src/media/asset.entity.js';

const SAMPLE_ASSET_1: Asset = {
  id: '11111111-1111-1111-1111-111111111111',
  type: 'file',
  name: 'demo1.png',
  url: '/assets/demo1.png',
  size: 1024,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const SAMPLE_ASSET_2: Asset = {
  id: '22222222-2222-2222-2222-222222222222',
  type: 'file',
  name: 'demo2.png',
  url: '/assets/demo2.png',
  size: 2048,
  createdAt: new Date('2026-01-02T00:00:00Z'),
};

const SAMPLE_ASSET_3: Asset = {
  id: '33333333-3333-3333-3333-333333333333',
  type: 'file',
  name: 'demo3.png',
  url: '/assets/demo3.png',
  size: 3072,
  createdAt: new Date('2026-01-03T00:00:00Z'),
};

function makeService(assets: Map<string, Asset | null>) {
  return {
    findById: jest.fn(async (id: string) => assets.get(id) ?? null),
  } as unknown as AssetService;
}

describe('AssetReferenceResolver', () => {
  describe('parseReferences', () => {
    it('提取单个素材引用', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const ids = resolver.parseReferences('请查看 [[素材:11111111-2222-3333-4444-555555555555]]');
      expect(ids).toEqual(['11111111-2222-3333-4444-555555555555']);
    });

    it('提取多个素材引用', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const ids = resolver.parseReferences(
        '图片1: [[素材:11111111-1111-1111-1111-111111111111]] 图片2: [[素材:22222222-2222-2222-2222-222222222222]]',
      );
      expect(ids).toEqual([
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ]);
    });

    it('去重重复引用', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const ids = resolver.parseReferences(
        '[[素材:11111111-2222-3333-4444-555555555555]] 和 [[素材:11111111-2222-3333-4444-555555555555]]',
      );
      expect(ids).toEqual(['11111111-2222-3333-4444-555555555555']);
    });

    it('无引用时返回空数组', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const ids = resolver.parseReferences('这是一段普通文本');
      expect(ids).toEqual([]);
    });

    it('不匹配不完整模式', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const ids = resolver.parseReferences('[[素材:]] 和 [[素材]]');
      expect(ids).toEqual([]);
    });
  });

  describe('hasReferences', () => {
    it('有引用时返回 true', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      expect(resolver.hasReferences('[[素材:11111111-2222-3333-4444-555555555555]]')).toBe(true);
    });

    it('无引用时返回 false', () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      expect(resolver.hasReferences('普通文本')).toBe(false);
    });
  });

  describe('resolveReference', () => {
    it('解析存在的素材', async () => {
      const assets = new Map([['11111111-1111-1111-1111-111111111111', SAMPLE_ASSET_1]]);
      const resolver = new AssetReferenceResolver(makeService(assets));
      const result = await resolver.resolveReference('11111111-1111-1111-1111-111111111111');
      expect(result).toEqual(SAMPLE_ASSET_1);
    });

    it('解析不存在的素材返回 null', async () => {
      const resolver = new AssetReferenceResolver(makeService(new Map()));
      const result = await resolver.resolveReference('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('resolveAll', () => {
    it('解析所有引用并限制数量', async () => {
      const assets = new Map([
        ['11111111-1111-1111-1111-111111111111', SAMPLE_ASSET_1],
        ['22222222-2222-2222-2222-222222222222', SAMPLE_ASSET_2],
        ['33333333-3333-3333-3333-333333333333', SAMPLE_ASSET_3],
      ]);
      const resolver = new AssetReferenceResolver(makeService(assets));
      const result = await resolver.resolveAll(
        '[[素材:11111111-1111-1111-1111-111111111111]] [[素材:22222222-2222-2222-2222-222222222222]] [[素材:33333333-3333-3333-3333-333333333333]]',
        2,
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('11111111-1111-1111-1111-111111111111');
      expect(result[1].id).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('跳过不存在的素材', async () => {
      const assets = new Map([
        ['11111111-1111-1111-1111-111111111111', SAMPLE_ASSET_1],
        ['22222222-2222-2222-2222-222222222222', null],
      ]);
      const resolver = new AssetReferenceResolver(makeService(assets));
      const result = await resolver.resolveAll(
        '[[素材:11111111-1111-1111-1111-111111111111]] [[素材:22222222-2222-2222-2222-222222222222]]',
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('11111111-1111-1111-1111-111111111111');
    });
  });
});