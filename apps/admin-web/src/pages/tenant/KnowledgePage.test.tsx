import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { KnowledgePage } from './KnowledgePage.js';

describe('knowledge one-click ingest', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('ingests via FastGPT proxy then refreshes collections', async () => {
    let collectionsCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/admin/knowledge/collections')) {
        collectionsCalls += 1;
        return new Response(
          JSON.stringify({
            datasetIds: ['ds1'],
            collections: [{ datasetId: 'ds1', count: collectionsCalls === 1 ? 1 : 2 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/admin/knowledge/ingest') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.question).toBe('怎么退款');
        expect(body.answer).toBe('按订单退');
        return new Response(JSON.stringify({ datasetId: 'ds1', ids: ['1'] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<KnowledgePage />);
    expect(await screen.findByText('ds1')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('问题'), { target: { value: '怎么退款' } });
    fireEvent.change(screen.getByLabelText('答案'), { target: { value: '按订单退' } });
    fireEvent.click(screen.getByRole('button', { name: '一键补录' }));

    expect(await screen.findByText('已写入 FastGPT')).toBeTruthy();
    await waitFor(() => expect(collectionsCalls).toBeGreaterThanOrEqual(2));
  });
});
