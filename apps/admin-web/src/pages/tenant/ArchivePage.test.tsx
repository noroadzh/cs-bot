import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { ArchivePage } from './ArchivePage.js';

describe('archive page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('loads jobs and pull state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/admin/archive/jobs')) {
          return new Response(
            JSON.stringify({ items: [{ id: 'j1', count: 3, createdAt: '2026-11-04T00:00:00Z' }] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/admin/archive/pull-state')) {
          return new Response(
            JSON.stringify({
              enabled: false,
              cursor: '',
              inFlight: false,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    render(<ArchivePage />);
    expect(await screen.findByText('j1')).toBeTruthy();
    expect(screen.getByText('触发拉取')).toBeTruthy();
  });
});
