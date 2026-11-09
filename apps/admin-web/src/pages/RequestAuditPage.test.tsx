import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../auth.js';
import { RequestAuditPage } from './RequestAuditPage.js';

describe('RequestAuditPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('admin', 'secret');
  });

  it('renders audit rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            rows: [{
              id: 1,
              username: 'admin',
              roleCode: 'admin',
              method: 'GET',
              path: '/admin/license',
              status: 200,
              costMs: 12,
              clientIp: '127.0.0.1',
              createdAt: '2026-01-01T00:00:00.000Z',
            }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(<RequestAuditPage />);
    expect(await screen.findByText('/admin/license')).toBeTruthy();
  });
});
