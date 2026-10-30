/**
 * FastGPTClient（R-2 单一出口）：URL 拼接、鉴权、参数透传、响应解析
 */
import { describe, it, expect, jest } from '@jest/globals';
import { FastGPTClient, parseChatResponse } from '../src/qa/fastgpt.client.js';

const makeHttp = (impl: any) => ({ post: jest.fn(impl), get: jest.fn() }) as any;

describe('FastGPTClient', () => {
  it('uses the same client for chat / dataset / search / collection', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const http = makeHttp(async (url: string, body: any) => {
      calls.push({ url, body });
      if (url === '/api/v1/chat/completions') return { data: { choices: [{ message: { content: 'A' } }] } };
      if (url === '/api/v1/core/dataset/create') return { data: { data: { _id: 'ds-1' } } };
      if (url === '/api/v1/core/dataset/data/pushData') return { data: { data: { ids: ['qa-1', 'qa-2'] } } };
      if (url === '/api/v1/core/dataset/searchTest') return { data: { data: { list: [{ id: 'qa-9', score: 0.95 }] } } };
      if (url === '/api/v1/core/dataset/collection/list') return { data: { data: { total: 42 } } };
      return { data: {} };
    });
    const c = new FastGPTClient({ baseUrl: 'http://fg/', apiKey: 'k', datasetIds: ['ds-1'] }, http);

    expect((await c.chat({ question: 'Q' })).answer).toBe('A');
    expect(await c.ensureDataset('历史语料-1')).toBe('ds-1');
    expect(await c.writeBatch('ds-1', [{ question: 'q', answer: 'a' }, { question: 'q2', answer: 'a2' }])).toEqual(['qa-1', 'qa-2']);
    expect(await c.searchTest('Q')).toEqual([{ id: 'qa-9', score: 0.95 }]);
    expect(await c.collectionCount('ds-1')).toBe(42);

    expect(calls.map((x) => x.url)).toEqual([
      '/api/v1/chat/completions',
      '/api/v1/core/dataset/create',
      '/api/v1/core/dataset/data/pushData',
      '/api/v1/core/dataset/searchTest',
      '/api/v1/core/dataset/collection/list',
    ]);
  });

  it('sends default datasetIds when the caller omits them', async () => {
    let body: any;
    const http = makeHttp(async (_u: string, b: any) => {
      body = b;
      return { data: {} };
    });
    const c = new FastGPTClient({ baseUrl: 'http://fg', apiKey: 'k', datasetIds: ['d1', 'd2'] }, http);
    await c.chat({ question: 'Q' });
    expect(body.datasetIds).toEqual(['d1', 'd2']);
    expect(body.model).toBe('fastgpt');
    expect(body.stream).toBe(false);
  });

  it('rejects an empty dataset id instead of caching it', async () => {
    const http = makeHttp(async () => ({ data: { data: {} } }));
    const c = new FastGPTClient({ baseUrl: 'http://fg', apiKey: 'k' }, http);
    await expect(c.ensureDataset('x')).rejects.toThrow(/no id/);
  });
});

describe('parseChatResponse', () => {
  it('reads quotes and sorts by score desc', () => {
    const res = parseChatResponse({
      choices: [{ message: { content: 'A' } }],
      responseData: [{ quoteList: [
        { id: 'q1', content: 'c1', score: 0.4 },
        { id: 'q2', content: 'c2', score: 0.9, datasetName: '退款政策' },
      ] }],
    });
    expect(res.answer).toBe('A');
    expect(res.score).toBe(0.9);
    expect(res.quotes.map((q) => q.id)).toEqual(['q2', 'q1']);
    expect(res.quotes[0].source).toBe('退款政策');
  });

  it('falls back to data[0].content and its score', () => {
    const res = parseChatResponse({ data: [{ content: '原生', score: 0.93 }] });
    expect(res).toMatchObject({ answer: '原生', score: 0.93, quotes: [] });
  });

  it('defaults score to 0 when there is no quote and no native score', () => {
    expect(parseChatResponse({}).score).toBe(0);
  });
});
