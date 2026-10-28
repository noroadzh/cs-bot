import { describe, it, expect, jest } from '@jest/globals';
import { HttpFastGptDatasetClient } from '../src/import/fastgpt-dataset.client.js';

const http = (impl: any) => ({ post: jest.fn(impl), get: jest.fn() }) as any;

describe('HttpFastGptDatasetClient retry', () => {
  it('retries 5xx up to 3 attempts then succeeds', async () => {
    let calls = 0;
    const client = new HttpFastGptDatasetClient(
      { baseUrl: 'http://fg', apiKey: 'k' },
      http(async () => {
        calls += 1;
        if (calls < 3) throw { response: { status: 500 } };
        return { data: { data: { ids: ['a', 'b'] } } };
      }),
    );
    const ids = await client.writeBatch('d1', [
      { question: 'q1', answer: 'a1' },
      { question: 'q2', answer: 'a2' },
    ]);
    expect(calls).toBe(3);
    expect(ids).toEqual(['a', 'b']);
  });

  it('does not retry 4xx', async () => {
    let calls = 0;
    const client = new HttpFastGptDatasetClient(
      { baseUrl: 'http://fg', apiKey: 'k' },
      http(async () => {
        calls += 1;
        throw { response: { status: 400 } };
      }),
    );
    await expect(client.writeBatch('d1', [{ question: 'q', answer: 'a' }])).rejects.toBeTruthy();
    expect(calls).toBe(1);
  });
});
