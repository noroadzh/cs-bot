import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../auth.js';
import { UsersPage } from './UsersPage.js';

describe('UsersPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('admin', 'secret');
  });

  it('lists users from admin API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            rows: [{ id: '1', username: 'admin', roleCode: 'admin', enabled: true, createdAt: '2026-01-01T00:00:00.000Z' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    render(<UsersPage />);
    await waitFor(() => expect(screen.getByText('创建用户')).toBeTruthy());
    expect((await screen.findAllByText('admin')).length).toBeGreaterThanOrEqual(1);
  });
});
