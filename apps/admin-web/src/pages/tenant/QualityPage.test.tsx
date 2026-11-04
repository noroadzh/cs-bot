import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { QualityPage } from './QualityPage.js';

describe('quality inspection page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('lists inspections from API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/admin/archive/quality-inspections')) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 1,
                  sensitiveHits: 2,
                  refusals: 1,
                  total: 10,
                  p95LatencyMs: 9000,
                  alerts: [{ rule: 'latency', detail: 'p95=9000' }],
                  windowLabel: '',
                  createdAt: '2026-11-04T00:00:00.000Z',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    render(<QualityPage />);
    expect(await screen.findByText('latency(p95=9000)')).toBeTruthy();
    expect(screen.getByText('提交采样')).toBeTruthy();
  });
});
