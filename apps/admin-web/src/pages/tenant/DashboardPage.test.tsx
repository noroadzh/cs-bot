import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { DashboardPage } from './DashboardPage.js';

describe('dashboard overview binding', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('loads counters from /admin/stats/overview?period=daily', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/admin/stats/overview?period=daily');
      return new Response(
        JSON.stringify({
          messages: 12,
          hits: 9,
          refusals: 2,
          hitRate: 0.75,
          refusalRate: 0.16,
          topMiss: [{ question: '怎么退款', score: 0.2, chatId: 'c1', status: 0 }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<DashboardPage />);
    expect(await screen.findByText('怎么退款')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });
});
