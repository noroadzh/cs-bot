import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveCredentials } from '../../auth.js';
import { TenantListPage } from './TenantListPage.js';

describe('platform reason', () => {
  beforeEach(() => {
    sessionStorage.clear();
    saveCredentials('ops', 'secret');
  });

  it('does not create a tenant without a reason', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rows: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter>
        <TenantListPage />
      </MemoryRouter>,
    );
    await screen.findByText('没有租户');
    fireEvent.change(screen.getByLabelText('租户名称'), { target: { value: '新租户' } });
    fireEvent.click(screen.getByRole('button', { name: /创\s*建/ }));
    expect(await screen.findByText('请填写原因')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
