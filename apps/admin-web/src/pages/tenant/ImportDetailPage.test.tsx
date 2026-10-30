import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { ImportDetailPage } from './ImportDetailPage.js';

describe('import review', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('submits a review status change', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (String(url).includes('/items/i1')) {
        return new Response(JSON.stringify({ id: 'i1' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).endsWith('/unpaired')) {
        return new Response(JSON.stringify({ rows: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        items: [{ id: 'i1', question: '退款', answerRedacted: '可以', reviewStatus: 'pending' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));

    render(
      <MemoryRouter initialEntries={['/import/job-1']}>
        <Routes>
          <Route path="/import/:id" element={<ImportDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const select = await screen.findByLabelText('审核 退款');
    fireEvent.change(select, { target: { value: 'approved' } });

    await vi.waitFor(() => {
      const review = calls.find((call) => call.url.includes('/items/i1'));
      expect(review?.body).toContain('"reviewStatus":"approved"');
    });
  });
});
