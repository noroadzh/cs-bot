/**
 * M10 重管线补充单测：审核清单 / 数据集 client / 近似去重
 */
import { describe, it, expect } from '@jest/globals';
import { buildReviewManifest, type ManifestRow } from '../src/import/review-manifest.js';
import { InMemoryDatasetClient } from '../src/import/fastgpt-dataset.client.js';
import { NoopSearchClient, HttpFastGptSearchClient } from '../src/import/near-duplicate.js';

describe('buildReviewManifest', () => {
  it('生成非空 xlsx buffer', async () => {
    const rows: ManifestRow[] = [
      {
        index: 1,
        conversationHash: 'abc123',
        occurredAt: '2026-01-01T00:00:00Z',
        question: '怎么退款',
        answer: '在订单页申请',
        redacted: false,
        sensitive: false,
        similar: false,
        suggestAction: 'keep',
        reviewResult: '',
      },
    ];
    const buf = await buildReviewManifest(rows);
    expect(buf.length).toBeGreaterThan(0);
    // xlsx 以 PK 魔数开头
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });
});

describe('InMemoryDatasetClient', () => {
  it('ensure/write/delete', async () => {
    const c = new InMemoryDatasetClient();
    const id = await c.ensureDataset('历史语料-job1');
    const ids = await c.writeBatch(id, [
      { question: 'q1', answer: 'a1' },
      { question: 'q2', answer: 'a2' },
    ]);
    expect(ids).toHaveLength(2);
    expect(c.datasets.get(id)).toHaveLength(2);
    await c.deleteDataset('历史语料-job1');
    expect(c.datasets.has('历史语料-job1')).toBe(false);
  });
});

describe('NearDuplicate', () => {
  it('Noop 永远返回 null', async () => {
    expect(await new NoopSearchClient().search('任意问题')).toBeNull();
  });

  it('HTTP 实现解析 top1 命中', async () => {
    const http = {
      post: async () => ({ data: { data: { list: [{ id: 'qa-9', score: 0.95 }] } } }),
    } as any;
    const c = new HttpFastGptSearchClient(
      { baseUrl: 'http://x', apiKey: 'k', datasetIds: ['d1'] },
      http,
    );
    expect(await c.search('问题')).toEqual({ id: 'qa-9', score: 0.95 });
  });

  it('HTTP 失败降级为 null', async () => {
    const http = {
      post: async () => {
        throw new Error('boom');
      },
    } as any;
    const c = new HttpFastGptSearchClient(
      { baseUrl: 'http://x', apiKey: 'k', datasetIds: ['d1'] },
      http,
    );
    expect(await c.search('问题')).toBeNull();
  });
});
